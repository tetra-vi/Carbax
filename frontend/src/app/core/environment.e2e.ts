// Local end-to-end testing only: Firebase Auth emulator, never used in production builds.
export const environment = {
  apiBase: '/api/v1',
  authEmulatorUrl: 'http://127.0.0.1:9099',
  firebase: { apiKey: 'demo-key', authDomain: 'demo-complybridge.firebaseapp.com', projectId: 'demo-complybridge', appId: 'demo-app' },
};
