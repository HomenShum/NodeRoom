import { defineExternalBenchmarkBrowserScenario } from "../common/browser-scenario";
import { loadTasks } from "./load-tasks";

defineExternalBenchmarkBrowserScenario("finch", loadTasks());
