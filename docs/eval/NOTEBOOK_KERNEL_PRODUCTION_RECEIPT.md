# Notebook Kernel Production Receipt

Generated: 2026-07-11

Status: **Passed**

NodeRoom now keeps the bounded safe kernel as the default and offers isolated
Pyodide execution through a disposable module worker. Network access and package
auto-loading are denied, inputs and outputs are capped, runs can be cancelled or
timed out, and every result is persisted through the existing artifact CAS lane.

## Proof

- 61 focused notebook, broker, work-artifact, and paper tests passed.
- TypeScript and the production build passed.
- Four concurrent broker runs never exceeded two active slots.
- The live browser completed a calculation with dataframe and chart output.
- The live browser blocked `import socket`, cancelled an infinite loop, and
  timed out an infinite loop after the bounded deadline.
- The live browser reported zero console errors and zero warnings.

Screenshots:

- `docs/eval/notebook-kernel-success-proof.png`
- `docs/eval/notebook-kernel-live-proof.png`

Machine-readable receipt:
`docs/eval/notebook-kernel-production-receipt.json`.

## Boundary

Container and Jupyter gateways are optional external deployment lanes. Their
adapter, approval, cancellation, streaming, and deny-network attestation
contracts are tested; NodeRoom does not claim a live external service where no
gateway or credentials were configured.
