use activitypub_federation::{
  config::Data,
  fetch::object_id::ObjectId,
  kinds::activity::RemoveType,
  protocol::helpers::deserialize_one_or_many,
};
use lemmy_api_utils::context::LemmyContext;
use lemmy_apub_objects::{
  objects::{community::ApubCommunity, person::ApubPerson},
  utils::protocol::InCommunity,
};
use lemmy_db_schema::source::community::Community;
use lemmy_utils::error::LemmyResult;
use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionRemove {
  pub(crate) actor: ObjectId<ApubPerson>,
  #[serde(deserialize_with = "deserialize_one_or_many")]
  pub(crate) to: Vec<Url>,
  pub(crate) object: Url,
  #[serde(deserialize_with = "deserialize_one_or_many")]
  pub(crate) cc: Vec<Url>,
  #[serde(rename = "type")]
  pub(crate) kind: RemoveType,
  pub(crate) target: Url,
  pub(crate) id: Url,
}

impl InCommunity for CollectionRemove {
  async fn community(&self, context: &Data<LemmyContext>) -> LemmyResult<ApubCommunity> {
    let (community, _) =
      Community::get_by_collection_url(&mut context.pool(), &self.clone().target.into()).await?;
    Ok(community.into())
  }
}
