/** Every address in the app, built in one place. */
export const paths = {
  home: '/',
  channel: (channelId: string) => `/channels/${channelId}`,
  thread: (channelId: string, rootMessageId: string) => `/channels/${channelId}/thread/${rootMessageId}`,
  channelDetails: (channelId: string) => `/channels/${channelId}/details`,
  admin: '/admin',
  adminUser: (userId: number) => `/admin/users/${userId}`,
  adminRestrictions: '/admin/restrictions',
} as const;
