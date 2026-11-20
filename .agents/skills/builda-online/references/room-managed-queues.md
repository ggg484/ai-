# GameData Message Queues Paused

Manual and managed GameData message queues are currently unavailable. Queue operations return `GameDataError` with `code`
`unsupported_capability` and `reason` `game_data_message_queue_disabled`. When you get this error, do not retry,
change the mutation ID, assume the enqueue succeeded, or emulate a queue by polling objects. Non-empty managed queue registrations are also unavailable.

Objects, ordered indexes and counters are not affected by this queue pause, but online use still depends on the game's permissions. The local Mock's historical queue behavior
does not reopen queues and does not prove that they work online.
