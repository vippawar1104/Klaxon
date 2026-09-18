import { useNavigate } from 'react-router-dom'

/**
 * Every marketing-page CTA funnels through here rather than duplicating auth
 * state on five separate pages. Home ("/") is the only component that owns a
 * session — these just navigate there with a query param it reads once on
 * arrival and hands off to its own signup/signin/demo handlers.
 */
export function useMarketingNav() {
  const navigate = useNavigate()
  return {
    goSignup: () => navigate('/?start=signup'),
    goSignin: () => navigate('/?start=signin'),
    goDemo: () => navigate('/?start=demo'),
  }
}
