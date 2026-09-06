package room

import (
	"context"
	"time"
)

type fakeClock struct {
	now time.Time
}

func (clock *fakeClock) Now() time.Time {
	return clock.now
}

type fakeIDGenerator struct {
	value string
	err   error
	calls int
}

func (generator *fakeIDGenerator) Generate() (string, error) {
	generator.calls++

	return generator.value, generator.err
}

type fakeInviteCodeGenerator struct {
	value *InviteCode
	err   error
	calls int
}

func (generator *fakeInviteCodeGenerator) Generate() (*InviteCode, error) {
	generator.calls++

	return generator.value, generator.err
}

type fakeRoomRepository struct {
	createdRoom *Room
	foundRoom   *Room
	updatedRoom *Room
	findCode    *InviteCode
	createErr   error
	findErr     error
	updateErr   error
	createCalls int
	findCalls   int
	updateCalls int
}

func (repository *fakeRoomRepository) Create(_ context.Context, createdRoom *Room) error {
	repository.createCalls++
	repository.createdRoom = createdRoom

	return repository.createErr
}

func (repository *fakeRoomRepository) FindByInviteCode(
	_ context.Context,
	inviteCode *InviteCode,
) (*Room, error) {
	repository.findCalls++
	repository.findCode = inviteCode

	return repository.foundRoom, repository.findErr
}

func (repository *fakeRoomRepository) Update(_ context.Context, updatedRoom *Room) error {
	repository.updateCalls++
	repository.updatedRoom = updatedRoom

	return repository.updateErr
}

type fakeMediaGateway struct {
	state         *MediaRoomState
	token         *ParticipantToken
	stateErr      error
	tokenErr      error
	stateRoomName string
	tokenRequest  ParticipantTokenRequest
	stateCalls    int
	tokenCalls    int
}

func (gateway *fakeMediaGateway) RoomState(_ context.Context, roomName string) (*MediaRoomState, error) {
	gateway.stateCalls++
	gateway.stateRoomName = roomName

	return gateway.state, gateway.stateErr
}

func (gateway *fakeMediaGateway) IssueParticipantToken(
	_ context.Context,
	request ParticipantTokenRequest,
) (*ParticipantToken, error) {
	gateway.tokenCalls++
	gateway.tokenRequest = request

	return gateway.token, gateway.tokenErr
}
