import React from 'react';
import { Composition } from 'remotion';
import { VIDEO } from './brand';
import { Promo, TOTAL_FRAMES } from './Promo';

export const RemotionRoot: React.FC = () => (
  <Composition
    id="promo"
    component={Promo}
    durationInFrames={TOTAL_FRAMES}
    fps={VIDEO.fps}
    width={VIDEO.width}
    height={VIDEO.height}
  />
);
