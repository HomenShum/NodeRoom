// Fixture: route file. External package import (react-router-dom) must be SKIPPED by the
// indexer; the barrel import and the tsconfig-paths alias import must both resolve.
// NOT compiled by the repo tsconfig (tests/fixtures is excluded) — read by the indexer only.
import { Route } from "react-router-dom";
import { Widget } from "./components";
import { formatLabel } from "@app/util";

export const ROUTE_TABLE = [{ path: "/settings", label: formatLabel("Settings") }];

export default function App() {
  return (
    <div data-testid="app-root">
      <Route path="/widgets" element={<Widget />} />
    </div>
  );
}
