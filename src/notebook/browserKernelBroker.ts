import { NotebookKernelBroker, createSafeNotebookKernelAdapter } from "./kernelBroker";
import { createPyodideNotebookKernelAdapter } from "./pyodideKernelAdapter";

let browserBroker: NotebookKernelBroker | undefined;

export function getBrowserNotebookKernelBroker(): NotebookKernelBroker {
  browserBroker ??= new NotebookKernelBroker({
    adapters: [createSafeNotebookKernelAdapter(), createPyodideNotebookKernelAdapter()],
    maxConcurrent: 2,
    maxQueued: 12,
  });
  return browserBroker;
}
