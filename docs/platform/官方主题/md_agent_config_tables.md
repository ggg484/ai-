# Dynamic Config Tables

Tables of game data that can change without releasing a new build: item stats, drop rates, event settings. Rooms and the frontend read them; only the author publishes them. Rooms see an update in about 2 seconds; a player's frontend sees it on its next read once its copy is a minute old.

Use them for rules and static data. Anything written at runtime belongs in Game Data or Player Data. Every table can be read by players, so never store secrets or values you need to hide.

## Commands

Run from the game project root, after the game has been published once:

```bash
builda config push items items.json
builda config list
builda config rollback items <sha256>
builda config delete items
```

`list` shows each table's version and the hashes `rollback` accepts. A rollback creates a new version with the old content.

## Rules

- The file is standard JSON and the top level is an object. Values can be any JSON.
- A table file is at most 64 KiB, and a game has at most 32 tables. Minify a file that is close to the limit.
- Table names match `[a-z][a-z0-9_]{0,63}`.
- No URLs and no binary data. Put images and other resources in `res/`.
- A game can publish at most 30 times per hour.
- Text is reviewed when you publish. If it is rejected, or review is unavailable, nothing changes and the live version stays.

The CLI checks only size and format. The server checks everything again and its error is the one to fix.

## Reading

Read a table by name. There are no versions to manage: a read returns the current content. The SDK guide for your engine has the exact call.

Different rooms and players can briefly see different content right after a publish, so don't rely on an update arriving at one exact moment: switch a timed event on in the table ahead of time, with its start time as a value. A table that doesn't exist returns "not found"; a table that can't be loaded on its first read returns "unavailable", which is different from an empty table.
