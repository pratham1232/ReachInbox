import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';

export function useAuth() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: api.getMe,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 401) {
        return false;
      }
      return failureCount < 1;
    },
  });

  const logout = async () => {
    await api.logout();
    queryClient.setQueryData(['auth', 'me'], null);
    await queryClient.invalidateQueries();
  };

  return {
    user: query.data ?? null,
    isLoading: query.isLoading,
    isAuthenticated: Boolean(query.data),
    logout,
  };
}
