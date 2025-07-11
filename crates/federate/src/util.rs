use anyhow::{anyhow, Context, Result};
use diesel::prelude::*;
use diesel_async::RunQueryDsl;
use either::Either::*;
use lemmy_apub_objects::objects::SiteOrMultiOrCommunityOrUser;
use lemmy_db_schema::{
  newtypes::ActivityId,
  source::{
    activity::SentActivity,
    community::Community,
    federation_queue_state::FederationQueueState,
    multi_community::MultiCommunity,
    person::Person,
    site::Site,
  },
  traits::ApubActor,
  utils::{get_conn, DbPool},
};
use lemmy_db_schema_file::enums::ActorType;
use lemmy_utils::error::LemmyError;
use moka::future::Cache;
use reqwest::Url;
use std::{
  fmt::Debug,
  future::Future,
  pin::Pin,
  sync::{Arc, LazyLock},
  time::Duration,
};
use tokio::{task::JoinHandle, time::sleep};
use tokio_util::sync::CancellationToken;

/// Decrease the delays of the federation queue.
/// Should only be used for federation tests since it significantly increases CPU and DB load of the
/// federation queue. This is intentionally a separate flag from other flags like debug_assertions,
/// since this is a invasive change we only need rarely.
pub(crate) static LEMMY_TEST_FAST_FEDERATION: LazyLock<bool> = LazyLock::new(|| {
  std::env::var("LEMMY_TEST_FAST_FEDERATION")
    .map(|s| !s.is_empty())
    .unwrap_or(false)
});

/// Recheck for new federation work every n seconds within each InstanceWorker.
///
/// When the queue is processed faster than new activities are added and it reaches the current time
/// with an empty batch, this is the delay the queue waits before it checks if new activities have
/// been added to the sent_activities table. This delay is only applied if no federated activity
/// happens during sending activities of the last batch, which means on high-activity instances it
/// may never be used. This means that it does not affect the maximum throughput of the queue.
///
///
/// This is thus the interval with which tokio wakes up each of the
/// InstanceWorkers to check for new work, if the queue previously was empty.
/// If the delay is too short, the workers (one per federated instance) will wake up too
/// often and consume a lot of CPU. If the delay is long, then activities on low-traffic instances
/// will on average take delay/2 seconds to federate.
pub(crate) static WORK_FINISHED_RECHECK_DELAY: LazyLock<Duration> = LazyLock::new(|| {
  if *LEMMY_TEST_FAST_FEDERATION {
    Duration::from_millis(100)
  } else {
    Duration::from_secs(30)
  }
});

/// Cache the latest activity id for a certain duration.
///
/// This cache is common to all the instance workers and prevents there from being more than one
/// call per N seconds between each DB query to find max(activity_id).
pub(crate) static CACHE_DURATION_LATEST_ID: LazyLock<Duration> = LazyLock::new(|| {
  if *LEMMY_TEST_FAST_FEDERATION {
    // in test mode, we use the same cache duration as the recheck delay so when recheck happens
    // data is fresh, accelerating the time the tests take.
    *WORK_FINISHED_RECHECK_DELAY
  } else {
    // in normal mode, we limit the query to one per second
    Duration::from_secs(1)
  }
});

/// A task that will be run in an infinite loop, unless it is cancelled.
/// If the task exits without being cancelled, an error will be logged and the task will be
/// restarted.
pub struct CancellableTask {
  f: Pin<Box<dyn Future<Output = Result<(), anyhow::Error>> + Send + 'static>>,
}

impl CancellableTask {
  /// spawn a task but with graceful shutdown
  pub fn spawn<F, R>(
    timeout: Duration,
    task: impl Fn(CancellationToken) -> F + Send + 'static,
  ) -> CancellableTask
  where
    F: Future<Output = R> + Send + 'static,
    R: Send + Debug + 'static,
  {
    let stop = CancellationToken::new();
    let stop2 = stop.clone();
    let task: JoinHandle<()> = tokio::spawn(async move {
      loop {
        let res = task(stop2.clone()).await;
        if stop2.is_cancelled() {
          return;
        } else {
          tracing::warn!("task exited, restarting: {res:?}");
        }
      }
    });
    let abort = task.abort_handle();
    CancellableTask {
      f: Box::pin(async move {
        stop.cancel();
        tokio::select! {
            r = task => {
              r.context("CancellableTask failed to cancel cleanly, returned error")?;
              Ok(())
            },
            _ = sleep(timeout) => {
                abort.abort();
                Err(anyhow!("CancellableTask aborted due to shutdown timeout"))
            }
        }
      }),
    }
  }

  /// cancel the cancel signal, wait for timeout for the task to stop gracefully, otherwise abort it
  pub async fn cancel(self) -> Result<(), anyhow::Error> {
    self.f.await
  }
}

/// assuming apub priv key and ids are immutable, then we don't need to have TTL
/// TODO: capacity should be configurable maybe based on memory use
pub(crate) async fn get_actor_cached(
  pool: &mut DbPool<'_>,
  actor_type: ActorType,
  actor_apub_id: &Url,
) -> Result<Arc<SiteOrMultiOrCommunityOrUser>> {
  static CACHE: LazyLock<Cache<Url, Arc<SiteOrMultiOrCommunityOrUser>>> =
    LazyLock::new(|| Cache::builder().max_capacity(10000).build());
  CACHE
    .try_get_with(actor_apub_id.clone(), async {
      let url = actor_apub_id.clone().into();
      let actor = match actor_type {
        ActorType::Site => Left(Left(
          Site::read_from_apub_id(pool, &url)
            .await?
            .context("apub site not found")?
            .into(),
        )),
        ActorType::Community => Right(Right(
          Community::read_from_apub_id(pool, &url)
            .await?
            .context("apub community not found")?
            .into(),
        )),
        ActorType::Person => Right(Left(
          Person::read_from_apub_id(pool, &url)
            .await?
            .context("apub person not found")?
            .into(),
        )),
        ActorType::MultiCommunity => Left(Right(
          MultiCommunity::read_from_ap_id(pool, &url)
            .await?
            .context("apub multi-comm not found")?
            .into(),
        )),
      };
      Result::<_, LemmyError>::Ok(Arc::new(actor))
    })
    .await
    .map_err(|e| anyhow::anyhow!("err getting actor {actor_type:?} {actor_apub_id}: {e:?}"))
}

type CachedActivityInfo = Option<Arc<SentActivity>>;
/// activities are immutable so cache does not need to have TTL
/// May return None if the corresponding id does not exist or is a received activity.
/// Holes in serials are expected behaviour in postgresql
/// todo: cache size should probably be configurable / dependent on desired memory usage
pub(crate) async fn get_activity_cached(
  pool: &mut DbPool<'_>,
  activity_id: ActivityId,
) -> Result<CachedActivityInfo> {
  static ACTIVITIES: LazyLock<Cache<ActivityId, CachedActivityInfo>> =
    LazyLock::new(|| Cache::builder().max_capacity(10000).build());
  ACTIVITIES
    .try_get_with(activity_id, async {
      Ok(Some(Arc::new(SentActivity::read(pool, activity_id).await?)))
    })
    .await
    .map_err(|e: Arc<LemmyError>| anyhow::anyhow!("err getting activity: {e:?}"))
}

/// return the most current activity id (with 1 second cache)
pub(crate) async fn get_latest_activity_id(pool: &mut DbPool<'_>) -> Result<ActivityId> {
  static CACHE: LazyLock<Cache<(), ActivityId>> = LazyLock::new(|| {
    Cache::builder()
      .time_to_live(*CACHE_DURATION_LATEST_ID)
      .build()
  });
  CACHE
    .try_get_with((), async {
      use diesel::dsl::max;
      use lemmy_db_schema_file::schema::sent_activity::dsl::{id, sent_activity};
      let conn = &mut get_conn(pool).await?;
      let seq: Option<ActivityId> = sent_activity.select(max(id)).get_result(conn).await?;
      let latest_id = seq.unwrap_or(ActivityId(0));
      anyhow::Result::<_, anyhow::Error>::Ok(latest_id)
    })
    .await
    .map_err(|e| anyhow::anyhow!("err getting id: {e:?}"))
}

/// the domain name is needed for logging, pass it to the stats printer so it doesn't need to look
/// up the domain itself
#[derive(Debug)]
pub(crate) struct FederationQueueStateWithDomain {
  pub domain: String,
  pub state: FederationQueueState,
}
