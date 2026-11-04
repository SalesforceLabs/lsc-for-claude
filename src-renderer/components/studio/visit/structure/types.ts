/** Structural copy of VisitStructure in src/studio/screens/visit/structure.ts. */
export interface VisitStructure {
  showDocumentId: boolean;
  durationMinutes: number;
  recordTypeMap: { accountRecordType: string; visitRecordType: string; sort: number }[];
  compliance: { id: string; label: string; required: boolean; sort: number; note?: boolean }[];
  attendees: Record<string, { id: string; name: string; account?: string; status?: string }[]>;
}
