/** Every address in the app, built in one place. */
export const paths = {
  home: '/',
  channel: (channelId: string) => `/channels/${channelId}`,
  thread: (channelId: string, rootMessageId: string) => `/channels/${channelId}/thread/${rootMessageId}`,
  channelDetails: (channelId: string) => `/channels/${channelId}/details`,
  channelPins: (channelId: string) => `/channels/${channelId}/pins`,
  admin: '/admin',
  adminUser: (userId: number) => `/admin/users/${userId}`,
  adminDeactivated: '/admin/deactivated',
  adminRestrictions: '/admin/restrictions',
} as const;
