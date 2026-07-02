import { pathToFileURL } from "node:url";
import { loadExternalBenchmarkLocalTasks } from "../common/local-tasks";

export function loadTasks() {
  return loadExternalBenchmarkLocalTasks("workstreambench");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(loadTasks(), null, 2));
}
