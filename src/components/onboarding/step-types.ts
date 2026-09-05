export type StepActions = {
  continue: () => void;
  saveExit: () => void;
  disabledReason?: string;
};

export type StepFooterProps = {
  pending: boolean;
  saveExitPending: boolean;
  onBack?: () => void;
  onRegisterActions: (actions: StepActions) => void;
};
