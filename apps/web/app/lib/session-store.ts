const tokenKey = 'fsf_access_token';

export const readStoredToken = () => {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(tokenKey);
};

export const storeToken = (token: string | null) => {
  if (typeof window === 'undefined') return;
  if (!token) {
    window.localStorage.removeItem(tokenKey);
    return;
  }
  window.localStorage.setItem(tokenKey, token);
};
