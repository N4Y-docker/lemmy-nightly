use crate::{
  newtypes::LocalUserId,
  source::password_reset_request::{PasswordResetRequest, PasswordResetRequestForm},
  utils::{get_conn, DbPool},
};
use diesel::{
  delete,
  dsl::{insert_into, now, IntervalDsl},
  sql_types::Timestamptz,
  ExpressionMethods,
  IntoSql,
};
use diesel_async::RunQueryDsl;
use lemmy_db_schema_file::schema::password_reset_request;
use lemmy_utils::error::{LemmyErrorExt, LemmyErrorType, LemmyResult};

impl PasswordResetRequest {
  pub async fn create(
    pool: &mut DbPool<'_>,
    local_user_id: LocalUserId,
    token_: String,
  ) -> LemmyResult<PasswordResetRequest> {
    let form = PasswordResetRequestForm {
      local_user_id,
      token: token_.into(),
    };
    let conn = &mut get_conn(pool).await?;
    insert_into(password_reset_request::table)
      .values(form)
      .get_result::<Self>(conn)
      .await
      .with_lemmy_type(LemmyErrorType::CouldntCreate)
  }

  pub async fn read_and_delete(pool: &mut DbPool<'_>, token_: &str) -> LemmyResult<Self> {
    let conn = &mut get_conn(pool).await?;
    delete(password_reset_request::table)
      .filter(password_reset_request::token.eq(token_))
      .filter(password_reset_request::published_at.gt(now.into_sql::<Timestamptz>() - 1.days()))
      .get_result(conn)
      .await
      .with_lemmy_type(LemmyErrorType::Deleted)
  }
}

#[cfg(test)]
mod tests {

  use crate::{
    source::{
      instance::Instance,
      local_user::{LocalUser, LocalUserInsertForm},
      password_reset_request::PasswordResetRequest,
      person::{Person, PersonInsertForm},
    },
    traits::Crud,
    utils::build_db_pool_for_tests,
  };
  use lemmy_utils::error::LemmyResult;
  use pretty_assertions::assert_eq;
  use serial_test::serial;

  #[tokio::test]
  #[serial]
  async fn test_password_reset() -> LemmyResult<()> {
    let pool = &build_db_pool_for_tests();
    let pool = &mut pool.into();

    // Setup
    let inserted_instance = Instance::read_or_create(pool, "my_domain.tld".to_string()).await?;
    let new_person = PersonInsertForm::test_form(inserted_instance.id, "thommy prw");
    let inserted_person = Person::create(pool, &new_person).await?;
    let new_local_user = LocalUserInsertForm::test_form(inserted_person.id);
    let inserted_local_user = LocalUser::create(pool, &new_local_user, vec![]).await?;

    // Create password reset token
    let token = "nope";
    let inserted_password_reset_request =
      PasswordResetRequest::create(pool, inserted_local_user.id, token.to_string()).await?;

    // Read it and verify
    let read_password_reset_request = PasswordResetRequest::read_and_delete(pool, token).await?;
    assert_eq!(
      inserted_password_reset_request.id,
      read_password_reset_request.id
    );
    assert_eq!(
      inserted_password_reset_request.local_user_id,
      read_password_reset_request.local_user_id
    );
    assert_eq!(
      inserted_password_reset_request.token,
      read_password_reset_request.token
    );
    assert_eq!(
      inserted_password_reset_request.published_at,
      read_password_reset_request.published_at
    );

    // Cannot reuse same token again
    let read_password_reset_request = PasswordResetRequest::read_and_delete(pool, token).await;
    assert!(read_password_reset_request.is_err());

    // Cleanup
    let num_deleted = Person::delete(pool, inserted_person.id).await?;
    Instance::delete(pool, inserted_instance.id).await?;
    assert_eq!(1, num_deleted);
    Ok(())
  }
}
