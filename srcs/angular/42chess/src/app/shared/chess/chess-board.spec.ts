import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BoardMove, ChessBoard } from './chess-board';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function square(fixture: ComponentFixture<ChessBoard>, name: string): HTMLButtonElement {
  return fixture.nativeElement.querySelector(`[data-square="${name}"]`);
}

function click(fixture: ComponentFixture<ChessBoard>, name: string): void {
  square(fixture, name).click();
  fixture.detectChanges();
}

function names(fixture: ComponentFixture<ChessBoard>, selector: string): string[] {
  return [...fixture.nativeElement.querySelectorAll(selector)].map(
    (element: Element) => element.getAttribute('data-square') ?? '',
  );
}

function render(inputs: Record<string, unknown>): {
  fixture: ComponentFixture<ChessBoard>;
  moved: ReturnType<typeof vi.fn>;
} {
  const fixture = TestBed.createComponent(ChessBoard);
  for (const [name, value] of Object.entries({ fen: START, ...inputs }))
    fixture.componentRef.setInput(name, value);
  const moved = vi.fn<(move: BoardMove) => void>();
  fixture.componentInstance.moved.subscribe(moved);
  fixture.detectChanges();
  return { fixture, moved };
}

describe('Chessboard component', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [ChessBoard] }));

  it('draws 64 squares and the pieces of a FEN position', () => {
    const { fixture } = render({ fen: '4k3/8/8/8/8/8/8/R3K3 w Q - 0 1' });
    expect(fixture.nativeElement.querySelectorAll('.square').length).toBe(64);
    expect(fixture.nativeElement.querySelectorAll('.piece').length).toBe(3);
    expect(square(fixture, 'a1').getAttribute('aria-label')).toBe('a1, white rook');
    expect(square(fixture, 'e8').getAttribute('aria-label')).toBe('e8, black king');
    expect(square(fixture, 'a1').classList).toContain('dark');
    expect(square(fixture, 'h1').classList).not.toContain('dark');
  });

  it('orients the board for the player colour', () => {
    const { fixture } = render({});
    const order = () => names(fixture, '.square');
    expect(order()[0]).toBe('a8');
    expect(order()[63]).toBe('h1');
    fixture.componentRef.setInput('orientation', 'BLACK');
    fixture.detectChanges();
    expect(order()[0]).toBe('h1');
    expect(order()[63]).toBe('a8');
    expect(fixture.nativeElement.querySelector('.coord.file')?.textContent).toBe('h');
  });

  it('selects a piece, shows its moves and emits the chosen one without playing it', () => {
    const { fixture, moved } = render({ interactive: true });
    click(fixture, 'g1');
    expect(square(fixture, 'g1').getAttribute('aria-pressed')).toBe('true');
    expect(names(fixture, '.target').sort()).toEqual(['f3', 'h3']);
    click(fixture, 'f3');
    expect(moved).toHaveBeenCalledWith({ from: 'g1', to: 'f3', promotion: null });
    expect(square(fixture, 'g1').getAttribute('aria-label')).toBe('g1, white knight');
    expect(names(fixture, '.target')).toEqual([]);
  });

  it('switches or clears the selection instead of sending an illegal move', () => {
    const { fixture, moved } = render({ interactive: true });
    click(fixture, 'e2');
    click(fixture, 'd2');
    expect(names(fixture, '.target').sort()).toEqual(['d3', 'd4']);
    click(fixture, 'd5');
    expect(names(fixture, '.selected')).toEqual([]);
    click(fixture, 'e7');
    expect(names(fixture, '.selected')).toEqual([]);
    expect(moved).not.toHaveBeenCalled();
  });

  it('only lets the viewer move their own colour on their turn', () => {
    const { fixture, moved } = render({ interactive: true, playerColor: 'BLACK' });
    expect(square(fixture, 'e2').disabled).toBe(true);
    click(fixture, 'e2');
    expect(moved).not.toHaveBeenCalled();
    fixture.componentRef.setInput(
      'fen',
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    );
    fixture.detectChanges();
    click(fixture, 'e7');
    click(fixture, 'e5');
    expect(moved).toHaveBeenCalledWith({ from: 'e7', to: 'e5', promotion: null });
  });

  it('stays read-only unless interactive', () => {
    const { fixture } = render({});
    expect(square(fixture, 'e2').disabled).toBe(true);
  });

  it('highlights the last move and distinguishes captures', () => {
    const { fixture } = render({
      fen: 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2',
      lastMove: { from: 'd7', to: 'd5' },
      interactive: true,
    });
    expect(names(fixture, '.last-move').sort()).toEqual(['d5', 'd7']);
    click(fixture, 'e4');
    expect(names(fixture, '.capture')).toEqual(['d5']);
    expect(square(fixture, 'd5').getAttribute('aria-label')).toBe('d5, black pawn, possible move');
  });

  it('asks which piece to promote to, and can be cancelled', () => {
    const { fixture, moved } = render({ fen: '4k3/P7/8/8/8/8/8/4K3 w - - 0 1', interactive: true });
    click(fixture, 'a7');
    click(fixture, 'a8');
    expect(moved).not.toHaveBeenCalled();
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]');
    expect(dialog?.querySelectorAll('[data-promotion]').length).toBe(4);
    fixture.nativeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    click(fixture, 'a7');
    click(fixture, 'a8');
    fixture.nativeElement.querySelector('[data-promotion="n"]').click();
    fixture.detectChanges();
    expect(moved).toHaveBeenCalledWith({ from: 'a7', to: 'a8', promotion: 'KNIGHT' });
  });

  it('marks the king in check', () => {
    const { fixture } = render({ fen: '4k3/8/8/8/8/8/8/4K2r w - - 0 1' });
    expect(names(fixture, '.check')).toEqual(['e1']);
    expect(square(fixture, 'e1').getAttribute('aria-label')).toBe('e1, white king, in check');
  });

  it('shows the end of the game and stops accepting moves', () => {
    const { fixture } = render({
      fen: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3',
      interactive: true,
    });
    const status = () => fixture.nativeElement.querySelector('[role="status"]')?.textContent.trim();
    expect(status()).toBe('Black wins · checkmate');
    expect(square(fixture, 'e1').disabled).toBe(true);
    fixture.componentRef.setInput('fen', START);
    fixture.componentRef.setInput('result', { winner: 'WHITE', reason: 'RESIGNATION' });
    fixture.detectChanges();
    expect(status()).toBe('White wins · resignation');
    fixture.componentRef.setInput('result', { winner: null, reason: 'DRAW_AGREEMENT' });
    fixture.detectChanges();
    expect(status()).toBe('Draw · draw agreed');
    expect(square(fixture, 'e2').disabled).toBe(true);
  });

  it('reports a position it cannot draw', () => {
    const { fixture } = render({ fen: 'not a fen' });
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'cannot be displayed',
    );
  });
});
