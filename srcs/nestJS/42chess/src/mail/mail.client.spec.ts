import { MailClient, MailUnavailableError } from './mail.client.js';

describe('MailClient', () => {
  const fetchMock = vi.fn();
  let mail: MailClient;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    mail = new MailClient();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
  });

  it('fails when forgemail refuses the request', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));

    await expect(
      mail.sendEmailVerification('alice@example.com', 'alice', 'tok'),
    ).rejects.toBeInstanceOf(MailUnavailableError);
  });

  it('fails when forgemail cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(
      mail.sendEmailVerification('alice@example.com', 'alice', 'tok'),
    ).rejects.toBeInstanceOf(MailUnavailableError);
  });
});
