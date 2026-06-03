import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const SIDEBAR_KEY = 'sidebarScroll';

export default function ScrollRestoration() {
  const { pathname } = useLocation();

  useEffect(() => {
    const saveAll = () => {
      try {
        const sidebar = document.querySelector('.app-sidebar-top');
        if (sidebar) sessionStorage.setItem(SIDEBAR_KEY, sidebar.scrollTop);
        const content = document.querySelector('.app-content');
        if (content) sessionStorage.setItem(`scroll:${pathname}`, content.scrollTop);
      } catch (_) {}
    };

    const handleClick = (e) => {
      const link = e.target.closest('a');
      if (link && link.getAttribute('href')?.startsWith('/')) {
        saveAll();
      }
    };

    document.addEventListener('click', handleClick, true);
    window.addEventListener('beforeunload', saveAll);
    return () => {
      document.removeEventListener('click', handleClick, true);
      window.removeEventListener('beforeunload', saveAll);
    };
  }, [pathname]);

  useEffect(() => {
    const sidebar = document.querySelector('.app-sidebar-top');
    const savedSidebar = sessionStorage.getItem(SIDEBAR_KEY);
    if (sidebar && savedSidebar) {
      sidebar.scrollTop = parseInt(savedSidebar, 10);
    }

    const content = document.querySelector('.app-content');
    const savedContent = sessionStorage.getItem(`scroll:${pathname}`);
    if (content && savedContent) {
      content.scrollTop = parseInt(savedContent, 10);
    }
  }, [pathname]);

  return null;
}
