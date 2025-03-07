#[cfg(feature = "full")]
use crate::schema::{person, person_actions};
use crate::{
  newtypes::{DbUrl, InstanceId, PersonId},
  sensitive::SensitiveString,
  source::placeholder_apub_url,
};
use chrono::{DateTime, Utc};
#[cfg(feature = "full")]
use diesel::{dsl, expression_methods::NullableExpressionMethods};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
#[cfg(feature = "full")]
use ts_rs::TS;

#[skip_serializing_none]
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "full", derive(Queryable, Selectable, Identifiable, TS))]
#[cfg_attr(feature = "full", diesel(table_name = person))]
#[cfg_attr(feature = "full", diesel(check_for_backend(diesel::pg::Pg)))]
#[cfg_attr(feature = "full", ts(export))]
/// A person.
pub struct Person {
  pub id: PersonId,
  pub name: String,
  /// A shorter display name.
  #[cfg_attr(feature = "full", ts(optional))]
  pub display_name: Option<String>,
  /// A URL for an avatar.
  #[cfg_attr(feature = "full", ts(optional))]
  pub avatar: Option<DbUrl>,
  /// Whether the person is banned.
  pub banned: bool,
  pub published: DateTime<Utc>,
  #[cfg_attr(feature = "full", ts(optional))]
  pub updated: Option<DateTime<Utc>>,
  /// The federated ap_id.
  pub ap_id: DbUrl,
  /// An optional bio, in markdown.
  #[cfg_attr(feature = "full", ts(optional))]
  pub bio: Option<String>,
  /// Whether the person is local to our site.
  pub local: bool,
  #[serde(skip)]
  pub private_key: Option<SensitiveString>,
  #[serde(skip)]
  pub public_key: String,
  #[serde(skip)]
  pub last_refreshed_at: DateTime<Utc>,
  /// A URL for a banner.
  #[cfg_attr(feature = "full", ts(optional))]
  pub banner: Option<DbUrl>,
  /// Whether the person is deleted.
  pub deleted: bool,
  #[cfg_attr(feature = "full", ts(skip))]
  #[serde(skip, default = "placeholder_apub_url")]
  pub inbox_url: DbUrl,
  /// A matrix id, usually given an @person:matrix.org
  #[cfg_attr(feature = "full", ts(optional))]
  pub matrix_user_id: Option<String>,
  /// Whether the person is a bot account.
  pub bot_account: bool,
  /// When their ban, if it exists, expires, if at all.
  #[cfg_attr(feature = "full", ts(optional))]
  pub ban_expires: Option<DateTime<Utc>>,
  pub instance_id: InstanceId,
  pub post_count: i64,
  #[serde(skip)]
  pub post_score: i64,
  pub comment_count: i64,
  #[serde(skip)]
  pub comment_score: i64,
}

#[derive(Clone, derive_new::new)]
#[cfg_attr(feature = "full", derive(Insertable, AsChangeset))]
#[cfg_attr(feature = "full", diesel(table_name = person))]
pub struct PersonInsertForm {
  pub name: String,
  pub public_key: String,
  pub instance_id: InstanceId,
  #[new(default)]
  pub display_name: Option<String>,
  #[new(default)]
  pub avatar: Option<DbUrl>,
  #[new(default)]
  pub banned: Option<bool>,
  #[new(default)]
  pub published: Option<DateTime<Utc>>,
  #[new(default)]
  pub updated: Option<DateTime<Utc>>,
  #[new(default)]
  pub ap_id: Option<DbUrl>,
  #[new(default)]
  pub bio: Option<String>,
  #[new(default)]
  pub local: Option<bool>,
  #[new(default)]
  pub private_key: Option<String>,
  #[new(default)]
  pub last_refreshed_at: Option<DateTime<Utc>>,
  #[new(default)]
  pub banner: Option<DbUrl>,
  #[new(default)]
  pub deleted: Option<bool>,
  #[new(default)]
  pub inbox_url: Option<DbUrl>,
  #[new(default)]
  pub matrix_user_id: Option<String>,
  #[new(default)]
  pub bot_account: Option<bool>,
  #[new(default)]
  pub ban_expires: Option<DateTime<Utc>>,
}

#[derive(Clone, Default)]
#[cfg_attr(feature = "full", derive(AsChangeset))]
#[cfg_attr(feature = "full", diesel(table_name = person))]
pub struct PersonUpdateForm {
  pub display_name: Option<Option<String>>,
  pub avatar: Option<Option<DbUrl>>,
  pub banned: Option<bool>,
  pub updated: Option<Option<DateTime<Utc>>>,
  pub ap_id: Option<DbUrl>,
  pub bio: Option<Option<String>>,
  pub local: Option<bool>,
  pub public_key: Option<String>,
  pub private_key: Option<Option<String>>,
  pub last_refreshed_at: Option<DateTime<Utc>>,
  pub banner: Option<Option<DbUrl>>,
  pub deleted: Option<bool>,
  pub inbox_url: Option<DbUrl>,
  pub matrix_user_id: Option<Option<String>>,
  pub bot_account: Option<bool>,
  pub ban_expires: Option<Option<DateTime<Utc>>>,
}

#[derive(PartialEq, Eq, Debug)]
#[cfg_attr(
  feature = "full",
  derive(Identifiable, Queryable, Selectable, Associations)
)]
#[cfg_attr(feature = "full", diesel(belongs_to(crate::source::person::Person)))]
#[cfg_attr(feature = "full", diesel(table_name = person_actions))]
#[cfg_attr(feature = "full", diesel(primary_key(person_id, target_id)))]
#[cfg_attr(feature = "full", diesel(check_for_backend(diesel::pg::Pg)))]
pub struct PersonFollower {
  #[cfg_attr(feature = "full", diesel(column_name = target_id))]
  pub person_id: PersonId,
  #[cfg_attr(feature = "full", diesel(column_name = person_id))]
  pub follower_id: PersonId,
  #[cfg_attr(feature = "full", diesel(select_expression = person_actions::followed.assume_not_null()))]
  #[cfg_attr(feature = "full", diesel(select_expression_type = dsl::AssumeNotNull<person_actions::followed>))]
  pub published: DateTime<Utc>,
  #[cfg_attr(feature = "full", diesel(select_expression = person_actions::follow_pending.assume_not_null()))]
  #[cfg_attr(feature = "full", diesel(select_expression_type = dsl::AssumeNotNull<person_actions::follow_pending>))]
  pub pending: bool,
}

#[derive(Clone)]
#[cfg_attr(feature = "full", derive(Insertable, AsChangeset))]
#[cfg_attr(feature = "full", diesel(table_name = person_actions))]
pub struct PersonFollowerForm {
  #[cfg_attr(feature = "full", diesel(column_name = target_id))]
  pub person_id: PersonId,
  #[cfg_attr(feature = "full", diesel(column_name = person_id))]
  pub follower_id: PersonId,
  #[cfg_attr(feature = "full", diesel(column_name = follow_pending))]
  pub pending: bool,
}
