export const getToken = () => localStorage.getItem("securechat_token");
export const setToken = (t: string) => localStorage.setItem("securechat_token", t);
export const removeToken = () => localStorage.removeItem("securechat_token");
export const getMe = (): { username: string } | null => {
  const raw = localStorage.getItem("securechat_me");
  return raw ? JSON.parse(raw) : null;
};
export const setMe = (u: { username: string }) => localStorage.setItem("securechat_me", JSON.stringify(u));
export const removeMe = () => localStorage.removeItem("securechat_me");