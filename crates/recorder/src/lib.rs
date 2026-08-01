//! The recorder sidecar (plan group 4, `adr:0005-wasapi-capture-in-a-minimal-sidecar`).
//!
//! It records and writes files, and knows nothing about the project directory,
//! transcription, or MCP. Everything except the capture device itself is
//! platform-neutral and tested on every platform; the WASAPI layer is a thin
//! edge behind a trait, which is what keeps the parts that can be wrong in a
//! way nobody notices — the time map above all — under test.
pub mod capture;
pub mod clock;
pub mod manifest;
pub mod pump;
pub mod rpc;
pub mod service;
pub mod session;
pub mod timemap;
pub mod track;

#[cfg(windows)]
pub mod wasapi_source;
