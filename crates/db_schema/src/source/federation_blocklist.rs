use crate::newtypes::InstanceId;
use chrono::{DateTime, Utc};
#[cfg(feature = "full")]
use lemmy_db_schema_file::schema::federation_blocklist;
use serde::{Deserialize, Serialize};
use std::fmt::Debug;

#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[cfg_attr(
  feature = "full",
  derive(Queryable, Selectable, Associations, Identifiable)
)]
#[cfg_attr(
  feature = "full",
  diesel(belongs_to(crate::source::instance::Instance))
)]
#[cfg_attr(feature = "full", diesel(table_name = federation_blocklist))]
#[cfg_attr(feature = "full", diesel(primary_key(instance_id)))]
#[cfg_attr(feature = "full", diesel(check_for_backend(diesel::pg::Pg)))]
#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]
#[cfg_attr(feature = "ts-rs", ts(optional_fields, export))]
pub struct FederationBlockList {
  pub instance_id: InstanceId,
  pub published_at: DateTime<Utc>,
  pub updated_at: Option<DateTime<Utc>>,
  pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Default)]
#[cfg_attr(feature = "full", derive(Insertable, AsChangeset))]
#[cfg_attr(feature = "full", diesel(table_name = federation_blocklist))]
pub struct FederationBlockListForm {
  pub instance_id: InstanceId,
  pub updated_at: Option<DateTime<Utc>>,
  pub expires_at: Option<DateTime<Utc>>,
}
