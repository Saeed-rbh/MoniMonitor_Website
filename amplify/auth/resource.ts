import { defineAuth, secret } from '@aws-amplify/backend';

export const auth = defineAuth({
  loginWith: {
    externalProviders: {
      google: {
        clientId: secret('GOOGLE_CLIENT_ID'),
        clientSecret: secret('GOOGLE_CLIENT_SECRET')
      },
      callbackUrls: [
        'http://localhost:3000/',
        'https://MoniMonitor.com'
      ],
      logoutUrls: ['http://localhost:3000/', 'https://MoniMonitor.com'],
    }
  }
});