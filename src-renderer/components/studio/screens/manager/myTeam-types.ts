/** Structural copy of the types in src/studio/screens/manager/myTeam.ts. Keep equal by hand. */
export interface MyTeamTerritory {
  id: string;
  name: string;
  repName: string;
  label: string;
}

export interface MyTeamWeekInfo {
  date: string;
  label: string;
  start: string;
}

export interface MyTeamActivity {
  id: string;
  type: string;
  color: string;
  muted: boolean;
  userName: string;
  timeRange: string;
  details: string;
  status: string;
  address: string;
}

export interface MyTeamDay {
  title: string;
  activities: MyTeamActivity[];
}

export interface MyTeamWeek extends MyTeamWeekInfo {
  days: MyTeamDay[];
}

export interface PublishedMyTeam {
  territories: MyTeamTerritory[];
  week: MyTeamWeekInfo;
  firstDay: string;
  timeZone: string;
  locale: string;
  note?: string;
}
