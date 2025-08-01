use crate::{
  activities::{
    check_community_deleted_or_removed,
    community::send_activity_in_community,
    generate_activity_id,
  },
  activity_lists::AnnouncableActivities,
  protocol::activities::community::lock_page::{LockPage, LockType, UndoLockPage},
};
use activitypub_federation::{
  config::Data,
  fetch::object_id::ObjectId,
  kinds::activity::UndoType,
  traits::Activity,
};
use lemmy_api_utils::context::LemmyContext;
use lemmy_apub_objects::{
  objects::community::ApubCommunity,
  utils::{
    functions::{generate_to, verify_mod_action, verify_person_in_community, verify_visibility},
    protocol::InCommunity,
  },
};
use lemmy_db_schema::{
  source::{
    activity::ActivitySendTargets,
    community::Community,
    mod_log::moderator::{ModLockPost, ModLockPostForm},
    person::Person,
    post::{Post, PostUpdateForm},
  },
  traits::Crud,
};
use lemmy_utils::error::{LemmyError, LemmyResult};
use url::Url;

#[async_trait::async_trait]
impl Activity for LockPage {
  type DataType = LemmyContext;
  type Error = LemmyError;

  fn id(&self) -> &Url {
    &self.id
  }

  fn actor(&self) -> &Url {
    self.actor.inner()
  }

  async fn verify(&self, context: &Data<Self::DataType>) -> Result<(), Self::Error> {
    let community = self.community(context).await?;
    verify_visibility(&self.to, &self.cc, &community)?;
    verify_person_in_community(&self.actor, &community, context).await?;
    check_community_deleted_or_removed(&community)?;
    verify_mod_action(&self.actor, &community, context).await?;
    Ok(())
  }

  async fn receive(self, context: &Data<Self::DataType>) -> Result<(), Self::Error> {
    let locked = Some(true);
    let reason = self.summary;
    let form = PostUpdateForm {
      locked,
      ..Default::default()
    };
    let post = self.object.dereference(context).await?;
    Post::update(&mut context.pool(), post.id, &form).await?;

    let form = ModLockPostForm {
      mod_person_id: self.actor.dereference(context).await?.id,
      post_id: post.id,
      locked,
      reason,
    };
    ModLockPost::create(&mut context.pool(), &form).await?;

    Ok(())
  }
}

#[async_trait::async_trait]
impl Activity for UndoLockPage {
  type DataType = LemmyContext;
  type Error = LemmyError;

  fn id(&self) -> &Url {
    &self.id
  }

  fn actor(&self) -> &Url {
    self.actor.inner()
  }

  async fn verify(&self, context: &Data<Self::DataType>) -> Result<(), Self::Error> {
    let community = self.object.community(context).await?;
    verify_visibility(&self.to, &self.cc, &community)?;
    verify_person_in_community(&self.actor, &community, context).await?;
    check_community_deleted_or_removed(&community)?;
    verify_mod_action(&self.actor, &community, context).await?;
    Ok(())
  }

  async fn receive(self, context: &Data<Self::DataType>) -> Result<(), Self::Error> {
    let locked = Some(false);
    let reason = self.summary;
    let form = PostUpdateForm {
      locked,
      ..Default::default()
    };
    let post = self.object.object.dereference(context).await?;
    Post::update(&mut context.pool(), post.id, &form).await?;

    let form = ModLockPostForm {
      mod_person_id: self.actor.dereference(context).await?.id,
      post_id: post.id,
      locked,
      reason,
    };
    ModLockPost::create(&mut context.pool(), &form).await?;

    Ok(())
  }
}

pub(crate) async fn send_lock_post(
  post: Post,
  actor: Person,
  locked: bool,
  reason: Option<String>,
  context: Data<LemmyContext>,
) -> LemmyResult<()> {
  let community: ApubCommunity = Community::read(&mut context.pool(), post.community_id)
    .await?
    .into();
  let id = generate_activity_id(LockType::Lock, &context)?;
  let community_id = community.ap_id.inner().clone();

  let lock = LockPage {
    actor: actor.ap_id.clone().into(),
    to: generate_to(&community)?,
    object: ObjectId::from(post.ap_id),
    cc: vec![community_id.clone()],
    kind: LockType::Lock,
    id,
    summary: reason.clone(),
  };
  let activity = if locked {
    AnnouncableActivities::LockPost(lock)
  } else {
    let id = generate_activity_id(UndoType::Undo, &context)?;
    let undo = UndoLockPage {
      actor: lock.actor.clone(),
      to: generate_to(&community)?,
      cc: lock.cc.clone(),
      kind: UndoType::Undo,
      id,
      object: lock,
      summary: reason,
    };
    AnnouncableActivities::UndoLockPost(undo)
  };
  send_activity_in_community(
    activity,
    &actor.into(),
    &community,
    ActivitySendTargets::empty(),
    true,
    &context,
  )
  .await?;
  Ok(())
}
