export function actionKeyboard(onClick) {
  return {
    role: 'button',
    tabIndex: onClick ? 0 : -1,
    'aria-disabled': onClick ? undefined : true,
    onKeyDown(event) {
      if (event.target !== event.currentTarget || event.repeat || !onClick) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.currentTarget.click();
      }
    },
  };
}
