/** Same steps as docs/samsung-setup.md; a test keeps the two in sync. */
export const SAMSUNG_SETUP_STEPS: string[] = [
  'Open Settings > Apps > Collector > Battery. Choose Unrestricted.',
  'Open Settings > Battery > Background usage limits > Never auto sleeping apps. Add Collector. Make sure Collector is not under "Sleeping apps" or "Deep sleeping apps".',
  'Open Settings > Apps > Collector > Permissions > Location. Choose Allow all the time. Leave "Use precise location" off.',
  'Open Settings > Apps > Collector > Permissions > Photos and videos. Choose Allow all.',
  'Open Settings > Apps > Collector. Turn off "Pause app activity if unused".',
  'In this app, tap "Choose Daylio folder". Then, in Daylio, export a CSV into that folder.',
];
