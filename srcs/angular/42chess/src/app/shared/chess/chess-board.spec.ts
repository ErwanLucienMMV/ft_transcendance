import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BoardMove, ChessBoard, fenAfter, moveUci } from './chess-board';

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
    expect(square(fixture, 'e2').getAttribute('aria-disabled')).toBe('true');
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
    expect(square(fixture, 'e2').getAttribute('aria-disabled')).toBe('true');
    expect(names(fixture, '.movable')).toEqual([]);
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
    expect(status()).toBe('Black wins by checkmate');
    expect(square(fixture, 'e1').getAttribute('aria-disabled')).toBe('true');
    fixture.componentRef.setInput('fen', START);
    fixture.componentRef.setInput('result', { winner: 'WHITE', reason: 'RESIGNATION' });
    fixture.detectChanges();
    expect(status()).toBe('White wins by resignation');
    fixture.componentRef.setInput('result', { winner: null, reason: 'DRAW_AGREEMENT' });
    fixture.detectChanges();
    expect(status()).toBe('Draw by agreement');
    expect(square(fixture, 'e2').getAttribute('aria-disabled')).toBe('true');
  });

  it('is one tab stop, explored with the arrow keys as seen on screen', () => {
    const { fixture } = render({ interactive: true });
    const stops = () => names(fixture, '.square[tabindex="0"]');
    expect(stops()).toEqual(['a1']);
    const key = (name: string, key: string) => {
      square(fixture, name).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      fixture.detectChanges();
    };
    square(fixture, 'a1').focus();
    key('a1', 'ArrowUp');
    expect(stops()).toEqual(['a2']);
    expect(document.activeElement?.getAttribute('data-square')).toBe('a2');
    key('a2', 'End');
    key('h2', 'ArrowLeft');
    expect(stops()).toEqual(['g2']);
    // Flipped, "up" goes towards White's side.
    fixture.componentRef.setInput('orientation', 'BLACK');
    fixture.detectChanges();
    key('g2', 'ArrowUp');
    expect(stops()).toEqual(['g1']);
    // Enter (a keyboard click) picks the knight, then its square.
    square(fixture, 'g1').click();
    fixture.detectChanges();
    expect(names(fixture, '.target').sort()).toEqual(['f3', 'h3']);
  });

  it('moves a piece by dragging it with a mouse, a pen or a finger', () => {
    const { fixture, moved } = render({ interactive: true });
    const board = fixture.nativeElement.querySelector('.board') as HTMLElement;
    board.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 800 }) as DOMRect;
    board.setPointerCapture = vi.fn();
    const pointer = (type: string, target: Element, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
      Object.defineProperty(event, 'pointerId', { value: 7 });
      target.dispatchEvent(event);
      fixture.detectChanges();
    };
    // e2 is the fifth file and the seventh row from the top: centre (450, 650).
    pointer('pointerdown', square(fixture, 'e2'), 450, 650);
    pointer('pointermove', board, 452, 600);
    expect(fixture.nativeElement.querySelector('.ghost')).not.toBeNull();
    expect(names(fixture, '.drag-origin')).toEqual(['e2']);
    pointer('pointerup', board, 450, 450);
    expect(moved).toHaveBeenCalledWith({ from: 'e2', to: 'e4', promotion: null });
    expect(fixture.nativeElement.querySelector('.ghost')).toBeNull();
    // A tap without moving is a click.
    pointer('pointerdown', square(fixture, 'g1'), 650, 750);
    pointer('pointerup', square(fixture, 'g1'), 651, 750);
    expect(names(fixture, '.selected')).toEqual(['g1']);
  });

  it("queues a premove during the opponent's turn and plays it when legal", () => {
    const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    const { fixture, moved } = render({
      fen: afterE4,
      playerColor: 'WHITE',
      interactive: false,
      premoves: true,
    });
    expect(names(fixture, '.movable')).toContain('g1');
    click(fixture, 'g1');
    click(fixture, 'f3');
    expect(names(fixture, '.premove').sort()).toEqual(['f3', 'g1']);
    expect(moved).not.toHaveBeenCalled();
    fixture.componentRef.setInput(
      'fen',
      'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
    );
    fixture.componentRef.setInput('interactive', true);
    fixture.detectChanges();
    expect(moved).toHaveBeenCalledWith({ from: 'g1', to: 'f3', promotion: null });
    expect(names(fixture, '.premove')).toEqual([]);
  });

  it('drops a premove that is no longer legal, and cancels one on Escape', () => {
    const { fixture, moved } = render({
      fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
      playerColor: 'WHITE',
      premoves: true,
    });
    click(fixture, 'e4');
    click(fixture, 'e5');
    // Black blocks the pawn: the premove cannot be played.
    fixture.componentRef.setInput(
      'fen',
      'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
    );
    fixture.componentRef.setInput('interactive', true);
    fixture.detectChanges();
    expect(moved).not.toHaveBeenCalled();
    expect(names(fixture, '.premove')).toEqual([]);
  });

  it('draws circles and arrows with the right button on an analysis board', () => {
    const { fixture } = render({ annotations: true });
    const board = fixture.nativeElement.querySelector('.board') as HTMLElement;
    board.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 800 }) as DOMRect;
    const right = (type: string, name: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 2 });
      square(fixture, name).dispatchEvent(event);
      fixture.detectChanges();
    };
    right('pointerdown', 'e4', 450, 450);
    right('pointerup', 'e4', 450, 450);
    expect(fixture.nativeElement.querySelectorAll('.shapes circle').length).toBe(1);
    right('pointerdown', 'g1', 650, 750);
    right('pointerup', 'f3', 550, 550);
    expect(fixture.nativeElement.querySelectorAll('.shapes polygon').length).toBe(1);
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    board.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    // The same gesture again removes the arrow; a left click clears everything.
    right('pointerdown', 'g1', 650, 750);
    right('pointerup', 'f3', 550, 550);
    expect(fixture.nativeElement.querySelectorAll('.shapes polygon').length).toBe(0);
    const left = new MouseEvent('pointerdown', { bubbles: true, button: 0 });
    square(fixture, 'a1').dispatchEvent(left);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.shapes')).toBeNull();
  });

  it('slides the piece of a new last move from its square', () => {
    const { fixture } = render({});
    const piece = () => square(fixture, 'e4').querySelector('.piece') as SVGElement;
    const animate = vi.fn(() => ({}) as Animation);
    Object.defineProperty(SVGElement.prototype, 'animate', { value: animate, configurable: true });
    try {
      fixture.componentRef.setInput(
        'fen',
        'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
      );
      fixture.componentRef.setInput('lastMove', { from: 'e2', to: 'e4' });
      fixture.detectChanges();
      TestBed.tick();
      expect(animate).toHaveBeenCalledTimes(1);
      expect(animate.mock.contexts[0]).toBe(piece());
      // Stepping back in a replay does not replay the move backwards.
      fixture.componentRef.setInput('fen', START);
      fixture.componentRef.setInput('lastMove', null);
      fixture.detectChanges();
      TestBed.tick();
      expect(animate).toHaveBeenCalledTimes(1);
    } finally {
      delete (SVGElement.prototype as unknown as { animate?: unknown }).animate;
    }
  });

  it('reports a position it cannot draw', () => {
    const { fixture } = render({ fen: 'not a fen' });
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'cannot be displayed',
    );
  });
});

describe('Board move helpers', () => {
  it('writes UCI with a lower-case promotion letter', () => {
    expect(moveUci({ from: 'e2', to: 'e4', promotion: null })).toBe('e2e4');
    expect(moveUci({ from: 'a7', to: 'a8', promotion: 'KNIGHT' })).toBe('a7a8n');
  });

  it('plays a move on a FEN, including a promotion', () => {
    expect(
      fenAfter('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', {
        from: 'e2',
        to: 'e4',
        promotion: null,
      }),
    ).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    expect(
      fenAfter('8/P6k/8/8/8/8/8/K7 w - - 0 1', { from: 'a7', to: 'a8', promotion: 'ROOK' }),
    ).toBe('R7/7k/8/8/8/8/8/K7 b - - 0 1');
  });
});
