# Correlate native playback intent with canonical updates

Provider callbacks can echo an app-driven seek, fire while media is loading, or
arrive after that provider instance has been replaced. The player correlates
local intents with command nonces and filters callbacks by the current provider
epoch. Applied fast commands complete on the matching canonical playback update.
Terminal outcomes and other commands can complete on the correlated command
acknowledgement. A newer canonical frame supersedes a pending intent and stale
same-media frames wait while that intent is pending. The three-second timeout
releases the guard if a completion is lost, and a brief post-acknowledgement
window absorbs trailing events. The periodic reconciliation loop can recognize a
matching nonce if the event path has not finished.

Readiness clears the media transition guard only for the matching media. An
eight-second timer and a ten-second read-time check bound the guard when a
provider never reports readiness. The intent manager also filters events during a
scrub and after programmatic seeks. A deliberate interaction can pass through the
post-seek window. A drag ends if its permission or duration changes, or if the
scrubber unmounts, so a document-level pointer release cannot complete an
obsolete seek. Undo reads the current flashback stack synchronously so it can
return the position before React processes a render update.

YouTube Pause and Twitch Pause need different treatment. A recent canonical seek
by itself is insufficient evidence that a YouTube Pause was synthetic. The player
validates provider health, media, epoch, and sequence after a debounce. During
that debounce, reconciliation holds the provider paused so an old canonical Play
cannot create an echo. After the Pause command is emitted, its nonce and media
context can allow a rapid native Play through the seek window. A later
programmatic seek clears that correlation. Twitch can emit a delayed Pause after a seek and pauses when scrubbing. The player uses a wider 2.5-second filter for recent seeks or commands and resumes a previously playing Twitch provider after a seek.

The player requests a user gesture before starting synchronized playback and
tries Twitch Play within the gesture because iframe playback can depend on user
activation. Twitch's internal player accessor and the rendered provider element
are both used as adapter candidates. The duration adapter accepts either the
provider's numeric duration or an event target. The player ignores native play,
pause, and seek callbacks from hidden tabs, where throttling can produce
misleading callbacks. It compares native events with the latest optimistic
playback status while that status is valid. It maps command verbs to playback
statuses before comparison. A server conflict signals the player to return to the
canonical timeline and can register a flashback for a large displacement.

The seek tests keep application permission, command, and reconciliation code
active while simulating provider callbacks. The intent manager tests force the
transition guard to survive the eight-second callback to exercise the independent
ten-second check.
