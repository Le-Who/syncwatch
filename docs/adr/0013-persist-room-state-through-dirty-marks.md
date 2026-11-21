# Persist room state through dirty marks

Live room changes update the cache first. Redis stores each pending database
write as a dirty room mark with a score that represents its pending write and
retry time. Each mark gets a later score, including marks made within one
millisecond. A new mutation during a retry window preserves the retry deadline
and advances the score by at least one millisecond. The worker acknowledges or
defers only the mark it read so a mutation during persistence remains queued.

A failed cache read preserves the dirty mark. The worker can then retry the read
without treating an unavailable cache as a deleted room. Shutdown processes other
rooms after a transient read or write failure and preserves retryable work. The
local queue claims each room before awaiting persistence, which leaves any new
mark available to a later flush.

Redis-less operation uses bounded process-local room storage. Reads and writes
clone mutable room snapshots so callers cannot change cached room state without a
repository write. Database hydration retains the room identity and starts a new
cache authority generation. The winning compare-and-swap stores that generation,
and normalization preserves it on subsequent reads.
