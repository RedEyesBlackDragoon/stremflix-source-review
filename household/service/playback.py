from dataclasses import dataclass


@dataclass(frozen=True)
class Progress:
    position: float
    duration: float
    occurred: float
    playback_session: str
    source_event_id: str
    completed: bool
    conflict: bool = False


def reconcile(previous, incoming, event_type):
    if previous is None:
        return incoming
    # Total ordering makes out-of-order delivery and timestamp ties deterministic.
    if (incoming.occurred, incoming.source_event_id) <= (previous.occurred, previous.source_event_id):
        return previous
    if previous.completed and not incoming.completed and event_type != "replay_started":
        return previous
    divergent = (previous.playback_session != incoming.playback_session and
                 incoming.occurred - previous.occurred < 60 and
                 abs(previous.position - incoming.position) > 120 and not previous.completed)
    if divergent:
        return Progress(incoming.position, incoming.duration, incoming.occurred,
                        incoming.playback_session, incoming.source_event_id, incoming.completed, True)
    return incoming
