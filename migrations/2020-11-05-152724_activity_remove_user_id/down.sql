ALTER TABLE activity
    ADD COLUMN user_id integer REFERENCES user_ ON UPDATE CASCADE ON DELETE CASCADE NOT NULL;

ALTER TABLE activity
    DROP COLUMN sensitive;

