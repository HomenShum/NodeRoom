export type DomainInvariantSeverity = "blocker" | "major" | "minor";

export interface DomainInvariant {
  id: string;
  description: string;
  severity: DomainInvariantSeverity;
  professionalFailure: string;
}

export interface DomainProofGate {
  id: string;
  description: string;
  requiredReceipt: string;
  blocksParentClaim: boolean;
  invariantIds: string[];
  command?: string;
}

export interface DomainVisualCheck {
  id: string;
  screenshotOrVideoRequired: boolean;
  canonicalViews?: string[];
}

export interface DomainPack {
  id: string;
  name: string;
  ontology: {
    entities: string[];
    relationships: string[];
  };
  invariants: DomainInvariant[];
  proofGates: DomainProofGate[];
  visualChecks?: DomainVisualCheck[];
  regressionFixtures: string[];
}

export type DomainGateVerdict = "pass" | "fail" | "not_run";

export interface DomainValidationResult {
  ok: boolean;
  domainPackId: string;
  caseId?: string;
  errors: string[];
  missingGateIds: string[];
}
