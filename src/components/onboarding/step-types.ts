export type StepActions = {
  continue: () => void;
  saveExit: () => void;
  disabledReason?: string;
  /**
   * "Skip to go live" for a step that has to save something first (the
   * business step saves the name before the rest is skipped). Steps without
   * one skip without saving what is on screen.
   */
  skipToGoLive?: () => void;
};

export type StepFooterProps = {
  pending: boolean;
  saveExitPending: boolean;
  onBack?: () => void;
  onRegisterActions: (actions: StepActions) => void;
};
