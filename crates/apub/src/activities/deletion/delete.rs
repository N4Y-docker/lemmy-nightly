use crate::{
  activities::{
    deletion::{receive_delete_action, verify_delete_activity, DeletableObjects},
    generate_activity_id,
  },
  protocol::{activities::deletion::delete::Delete, IdOrNestedObject},
};
use activitypub_federation::{config::Data, kinds::activity::DeleteType, traits::Activity};
use lemmy_api_utils::context::LemmyContext;
use lemmy_apub_objects::objects::person::ApubPerson;
use lemmy_db_schema::{
  source::{
    comment::{Comment, CommentUpdateForm},
    comment_report::CommentReport,
    community::{Community, CommunityUpdateForm},
    community_report::CommunityReport,
    mod_log::{
      admin::{AdminRemoveCommunity, AdminRemoveCommunityForm},
      moderator::{ModRemoveComment, ModRemoveCommentForm, ModRemovePost, ModRemovePostForm},
    },
    post::{Post, PostUpdateForm},
    post_report::PostReport,
  },
  traits::{Crud, Reportable},
};
use lemmy_utils::error::{FederationError, LemmyError, LemmyErrorType, LemmyResult};
use url::Url;

#[async_trait::async_trait]
impl Activity for Delete {
  type DataType = LemmyContext;
  type Error = LemmyError;

  fn id(&self) -> &Url {
    &self.id
  }

  fn actor(&self) -> &Url {
    self.actor.inner()
  }

  async fn verify(&self, context: &Data<Self::DataType>) -> LemmyResult<()> {
    verify_delete_activity(self, self.summary.is_some(), context).await?;
    Ok(())
  }

  async fn receive(self, context: &Data<LemmyContext>) -> LemmyResult<()> {
    if let Some(reason) = self.summary {
      // We set reason to empty string if it doesn't exist, to distinguish between delete and
      // remove. Here we change it back to option, so we don't write it to db.
      let reason = if reason.is_empty() {
        None
      } else {
        Some(reason)
      };
      receive_remove_action(
        &self.actor.dereference(context).await?,
        self.object.id(),
        reason,
        context,
      )
      .await
    } else {
      receive_delete_action(
        self.object.id(),
        &self.actor,
        true,
        self.remove_data,
        context,
      )
      .await
    }
  }
}

impl Delete {
  pub(in crate::activities::deletion) fn new(
    actor: &ApubPerson,
    object: DeletableObjects,
    to: Vec<Url>,
    community: Option<&Community>,
    summary: Option<String>,
    context: &Data<LemmyContext>,
  ) -> LemmyResult<Delete> {
    let id = generate_activity_id(DeleteType::Delete, context)?;
    let cc: Option<Url> = community.map(|c| c.ap_id.clone().into());
    Ok(Delete {
      actor: actor.ap_id.clone().into(),
      to,
      object: IdOrNestedObject::Id(object.id().clone()),
      cc: cc.into_iter().collect(),
      kind: DeleteType::Delete,
      summary,
      id,
      remove_data: None,
    })
  }
}

pub(in crate::activities) async fn receive_remove_action(
  actor: &ApubPerson,
  object: &Url,
  reason: Option<String>,
  context: &Data<LemmyContext>,
) -> LemmyResult<()> {
  match DeletableObjects::read_from_db(object, context).await? {
    DeletableObjects::Community(community) => {
      if community.local {
        Err(FederationError::OnlyLocalAdminCanRemoveCommunity)?
      }
      CommunityReport::resolve_all_for_object(&mut context.pool(), community.id, actor.id).await?;
      let form = AdminRemoveCommunityForm {
        mod_person_id: actor.id,
        community_id: community.id,
        removed: Some(true),
        reason,
      };
      AdminRemoveCommunity::create(&mut context.pool(), &form).await?;
      Community::update(
        &mut context.pool(),
        community.id,
        &CommunityUpdateForm {
          removed: Some(true),
          ..Default::default()
        },
      )
      .await?;
    }
    DeletableObjects::Post(post) => {
      PostReport::resolve_all_for_object(&mut context.pool(), post.id, actor.id).await?;
      let form = ModRemovePostForm {
        mod_person_id: actor.id,
        post_id: post.id,
        removed: Some(true),
        reason,
      };
      ModRemovePost::create(&mut context.pool(), &form).await?;
      Post::update(
        &mut context.pool(),
        post.id,
        &PostUpdateForm {
          removed: Some(true),
          ..Default::default()
        },
      )
      .await?;
    }
    DeletableObjects::Comment(comment) => {
      CommentReport::resolve_all_for_object(&mut context.pool(), comment.id, actor.id).await?;
      let form = ModRemoveCommentForm {
        mod_person_id: actor.id,
        comment_id: comment.id,
        removed: Some(true),
        reason,
      };
      ModRemoveComment::create(&mut context.pool(), &form).await?;
      Comment::update(
        &mut context.pool(),
        comment.id,
        &CommentUpdateForm {
          removed: Some(true),
          ..Default::default()
        },
      )
      .await?;
    }
    // TODO these need to be implemented yet, for now, return errors
    DeletableObjects::PrivateMessage(_) => Err(LemmyErrorType::NotFound)?,
    DeletableObjects::Person(_) => Err(LemmyErrorType::NotFound)?,
  }
  Ok(())
}
