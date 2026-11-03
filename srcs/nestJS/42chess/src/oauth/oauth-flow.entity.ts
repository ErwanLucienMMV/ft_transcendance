import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { Provider } from './oauth-provider.js';

@Entity('oauth_flows')
export class OAuthFlow {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id: string;
  @Column({ type: 'varchar', length: 64 }) browserHash: string;
  @Column({ type: 'varchar', length: 16 }) purpose: 'authorize' | 'handoff';
  @Column({ type: 'varchar', length: 32 }) provider: Provider;
  @Column({ type: 'varchar', length: 128, nullable: true }) verifier:
    string | null;
  @Column({ type: 'uuid', nullable: true }) userId: string | null;
  @Column({ type: 'uuid', nullable: true }) sessionId: string | null;
  @Column('timestamptz') expiresAt: Date;
  /** The sign-in created the account: the front invites to pick a username. */
  @Column({ type: 'boolean', default: false }) created: boolean;
}
