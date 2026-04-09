use std::sync::mpsc;
use serde::{Deserialize, Serialize};

/// Debug events forwarded from the DAP reader thread to the frontend.
///
/// This is the critical missing piece — the current Buster code has a TODO
/// at line 78 where events should be forwarded but aren't. This module
/// provides an async-safe channel for event delivery.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum DebugEvent {
    /// The debuggee has stopped (breakpoint hit, step complete, etc.).
    Stopped {
        reason: String,
        thread_id: i64,
        description: Option<String>,
    },
    /// The debuggee has been continued.
    Continued { thread_id: i64 },
    /// The debug session has terminated.
    Terminated,
    /// The debuggee process has exited.
    Exited { exit_code: i64 },
    /// Output from the debuggee (stdout, stderr, console).
    Output {
        category: String,
        output: String,
    },
    /// A breakpoint has changed state.
    BreakpointChanged {
        reason: String,
        source: Option<String>,
        line: Option<u32>,
        verified: bool,
    },
    /// A new thread was created.
    ThreadStarted { thread_id: i64, name: String },
    /// A thread has exited.
    ThreadExited { thread_id: i64 },
}

/// Channel for sending debug events from the reader thread to the frontend.
///
/// Uses std::sync::mpsc which is safe across threads (no raw pointer casts,
/// no unsafe Send/Sync impls — fixing the UB in the current code).
pub struct EventChannel {
    sender: mpsc::Sender<DebugEvent>,
    receiver: mpsc::Receiver<DebugEvent>,
}

impl EventChannel {
    pub fn new() -> Self {
        let (sender, receiver) = mpsc::channel();
        Self { sender, receiver }
    }

    /// Get a clone of the sender for the reader thread.
    pub fn sender(&self) -> mpsc::Sender<DebugEvent> {
        self.sender.clone()
    }

    /// Try to receive a pending event (non-blocking).
    pub fn try_recv(&self) -> Option<DebugEvent> {
        self.receiver.try_recv().ok()
    }

    /// Drain all pending events.
    pub fn drain(&self) -> Vec<DebugEvent> {
        let mut events = Vec::new();
        while let Ok(event) = self.receiver.try_recv() {
            events.push(event);
        }
        events
    }
}

impl Default for EventChannel {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_channel_send_recv() {
        let channel = EventChannel::new();
        let sender = channel.sender();

        sender
            .send(DebugEvent::Stopped {
                reason: "breakpoint".into(),
                thread_id: 1,
                description: None,
            })
            .unwrap();

        let event = channel.try_recv().unwrap();
        match event {
            DebugEvent::Stopped { reason, thread_id, .. } => {
                assert_eq!(reason, "breakpoint");
                assert_eq!(thread_id, 1);
            }
            _ => panic!("expected Stopped event"),
        }
    }

    #[test]
    fn test_drain_multiple_events() {
        let channel = EventChannel::new();
        let sender = channel.sender();

        sender.send(DebugEvent::Terminated).unwrap();
        sender.send(DebugEvent::Exited { exit_code: 0 }).unwrap();

        let events = channel.drain();
        assert_eq!(events.len(), 2);
    }

    #[test]
    fn test_thread_safe_sender() {
        let channel = EventChannel::new();
        let sender = channel.sender();

        let handle = std::thread::spawn(move || {
            sender
                .send(DebugEvent::Output {
                    category: "stdout".into(),
                    output: "hello from thread".into(),
                })
                .unwrap();
        });

        handle.join().unwrap();
        let event = channel.try_recv().unwrap();
        match event {
            DebugEvent::Output { output, .. } => assert_eq!(output, "hello from thread"),
            _ => panic!("expected Output event"),
        }
    }
}
