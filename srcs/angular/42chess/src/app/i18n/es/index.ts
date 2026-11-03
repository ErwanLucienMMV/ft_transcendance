import type { Translation } from '../../core/i18n/i18n';
import { app, titles } from './app';
import { common } from './common';
import { errors } from './errors';
import { settings } from './settings';
import { chess, shared } from './chess';
import { home } from './home';
import { auth } from './auth';
import { play, game } from './game';
import { board, live, history } from './views';
import { social, chat, notices } from './social';
import { progression } from './progression';
import { puzzle } from './puzzle';
import { status } from './status';
import { legal, design } from './pages';

export const es: Translation = {
  app,
  titles,
  common,
  errors,
  settings,
  chess,
  shared,
  home,
  auth,
  play,
  game,
  board,
  live,
  history,
  social,
  chat,
  notices,
  progression,
  puzzle,
  status,
  legal,
  design,
};
