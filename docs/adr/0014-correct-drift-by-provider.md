# Correct drift according to the playback provider

Playback reconciliation computes a target from canonical time and chooses between
changing playback rate and seeking to that target. Rate correction uses
hysteresis to avoid oscillation around a single threshold. The stop threshold
stays below the start threshold, and correction tiers run from largest drift to
smallest. Large drift is handled by hard seeks. Provider capabilities affect both
the seek threshold and the rate adjustment. Twitch and Vimeo avoid transient rate
correction, while YouTube caps the adjustment at three percent to limit
perceptible speed changes. Twitch uses a lower hard-seek threshold, and recovery
from a local stall can seek at a smaller drift than steady playback.

The scrubber samples progress outside React state so animation-frame updates
avoid re-rendering the player. It updates the progress fill frequently and
formats the visible time and accessibility value when the displayed second
changes. While dragging, local pointer position owns the scrubber display until
the user releases or cancels it.
