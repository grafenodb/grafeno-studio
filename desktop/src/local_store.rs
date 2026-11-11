//! Client-only data kept beside Grafeno Desktop. This database never belongs
//! to, or travels through, a Grafeno engine.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Default)]
pub struct LocalStore(Mutex<Option<Connection>>);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredScript {
    pub owner: String,
    pub id: String,
    pub name: String,
    pub text: String,
    pub namespace: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_opened_at: i64,
}

fn prepare(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         CREATE TABLE IF NOT EXISTS scripts (
           owner TEXT NOT NULL,
           id TEXT NOT NULL,
           name TEXT NOT NULL,
           text TEXT NOT NULL,
           namespace TEXT,
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL,
           last_opened_at INTEGER NOT NULL,
           PRIMARY KEY (owner, id)
         );
         CREATE INDEX IF NOT EXISTS scripts_owner_opened
           ON scripts (owner, last_opened_at DESC);
         CREATE TABLE IF NOT EXISTS settings (
           owner TEXT NOT NULL,
           key TEXT NOT NULL,
           value TEXT NOT NULL,
           PRIMARY KEY (owner, key)
         );",
    )
}

impl LocalStore {
    pub fn initialize(&self, path: &Path) -> Result<(), String> {
        if let Some(directory) = path.parent() {
            std::fs::create_dir_all(directory)
                .map_err(|error| format!("cannot create the client data directory: {error}"))?;
        }
        let connection = Connection::open(path)
            .map_err(|error| format!("cannot open the client database: {error}"))?;
        prepare(&connection)
            .map_err(|error| format!("cannot prepare the client database: {error}"))?;
        *self
            .0
            .lock()
            .map_err(|_| "client database lock is poisoned".to_owned())? = Some(connection);
        Ok(())
    }

    fn with<T>(&self, work: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T, String> {
        let guard = self
            .0
            .lock()
            .map_err(|_| "client database lock is poisoned".to_owned())?;
        let connection = guard
            .as_ref()
            .ok_or_else(|| "client database is not ready".to_owned())?;
        work(connection).map_err(|error| format!("client database error: {error}"))
    }
}

#[tauri::command]
pub fn local_scripts(
    store: State<'_, LocalStore>,
    owner: String,
) -> Result<Vec<StoredScript>, String> {
    store.with(|connection| {
        let mut statement = connection.prepare(
            "SELECT owner, id, name, text, namespace, created_at, updated_at, last_opened_at
             FROM scripts WHERE owner = ?1 ORDER BY created_at ASC",
        )?;
        statement
            .query_map([owner], |row| {
                Ok(StoredScript {
                    owner: row.get(0)?,
                    id: row.get(1)?,
                    name: row.get(2)?,
                    text: row.get(3)?,
                    namespace: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                    last_opened_at: row.get(7)?,
                })
            })?
            .collect()
    })
}

#[tauri::command]
pub fn local_put_script(store: State<'_, LocalStore>, script: StoredScript) -> Result<(), String> {
    store.with(|connection| {
        connection.execute(
            "INSERT INTO scripts
               (owner, id, name, text, namespace, created_at, updated_at, last_opened_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(owner, id) DO UPDATE SET
               name = excluded.name,
               text = excluded.text,
               namespace = excluded.namespace,
               updated_at = excluded.updated_at,
               last_opened_at = excluded.last_opened_at",
            params![
                script.owner,
                script.id,
                script.name,
                script.text,
                script.namespace,
                script.created_at,
                script.updated_at,
                script.last_opened_at,
            ],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn local_delete_script(
    store: State<'_, LocalStore>,
    owner: String,
    id: String,
) -> Result<(), String> {
    store.with(|connection| {
        connection.execute(
            "DELETE FROM scripts WHERE owner = ?1 AND id = ?2",
            params![owner, id],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn local_setting(
    store: State<'_, LocalStore>,
    owner: String,
    key: String,
) -> Result<Option<String>, String> {
    store.with(|connection| {
        connection
            .query_row(
                "SELECT value FROM settings WHERE owner = ?1 AND key = ?2",
                params![owner, key],
                |row| row.get(0),
            )
            .optional()
    })
}

#[tauri::command]
pub fn local_put_setting(
    store: State<'_, LocalStore>,
    owner: String,
    key: String,
    value: String,
) -> Result<(), String> {
    store.with(|connection| {
        connection.execute(
            "INSERT INTO settings (owner, key, value) VALUES (?1, ?2, ?3)
             ON CONFLICT(owner, key) DO UPDATE SET value = excluded.value",
            params![owner, key, value],
        )?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_can_be_created_twice() {
        let connection = Connection::open_in_memory().unwrap();
        prepare(&connection).unwrap();
        prepare(&connection).unwrap();
        let tables: i64 = connection
            .query_row("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name IN ('scripts', 'settings')", [], |row| row.get(0))
            .unwrap();
        assert_eq!(tables, 2);
    }
}
