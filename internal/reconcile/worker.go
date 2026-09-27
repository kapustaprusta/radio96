package reconcile

import (
	"context"
	"log/slog"
	"time"
)

const Interval = 30 * time.Second

type UseCase interface {
	Execute(ctx context.Context) error
}

type Worker struct {
	useCase UseCase
	logger  *slog.Logger
}

func NewWorker(useCase UseCase, logger *slog.Logger) *Worker {
	return &Worker{useCase: useCase, logger: logger}
}

func (worker *Worker) Run(ctx context.Context) {
	ticker := time.NewTicker(Interval)
	defer ticker.Stop()
	for {
		if err := worker.useCase.Execute(ctx); err != nil && ctx.Err() == nil {
			worker.logger.Warn("room reconciliation failed", slog.String("error", err.Error()))
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
