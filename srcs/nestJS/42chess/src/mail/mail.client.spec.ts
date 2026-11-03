import { Logger } from '@nestjs/common';
import { MailClient, MailUnavailableError } from './mail.client.js';

describe('MailClient', () => {
  const fetchMock = vi.fn();
  let mail: MailClient;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    errorSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    mail = new MailClient();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('asks forgemail to send the verification email', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));

    await mail.sendEmailVerification('alice@example.com', 'alice', 'tok');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/v1\/mails\/email-verification$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      to: 'alice@example.com',
      username: 'alice',
      token: 'tok',
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('fails when forgemail refuses the request', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));

    await expect(
      mail.sendEmailVerification('alice@example.com', 'alice', 'tok'),
    ).rejects.toBeInstanceOf(MailUnavailableError);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('forgemail could not send the email (HTTP 503)'),
    );
  });

  it('fails when forgemail cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(
      mail.sendEmailVerification('alice@example.com', 'alice', 'tok'),
    ).rejects.toBeInstanceOf(MailUnavailableError);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('forgemail unreachable'),
    );
  });

  it('sends password reset links and account notices', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    await mail.sendPasswordReset('alice@example.com', 'alice', 'tok');
    await mail.notify('alice@example.com', 'alice', 'password-changed');
    const calls = fetchMock.mock.calls as [string, RequestInit][];
    expect(calls[0][0]).toMatch(/\/v1\/mails\/password-reset$/);
    expect(calls[1][0]).toMatch(/\/v1\/mails\/notice$/);
    expect(JSON.parse(calls[1][1].body as string)).toEqual({
      to: 'alice@example.com',
      username: 'alice',
      kind: 'password-changed',
    });
  });

  it('never fails a change because its notice could not be sent', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fetchMock.mockRejectedValue(new Error('down'));
    await expect(
      mail.notify('alice@example.com', 'alice', 'account-deleted'),
    ).resolves.toBeUndefined();
    await mail.notify(null, 'alice', 'account-deleted');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
