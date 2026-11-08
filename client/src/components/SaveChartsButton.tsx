import { RefObject, useState } from 'react';
import { Button } from './Button';
import { chartGridIn, chartsFilename, saveChartGrid } from '../utils/saveCharts';

export function SaveChartsButton({
  cardRef,
  kind,
}: {
  cardRef: RefObject<HTMLElement | null>;
  kind: 'Server' | 'Algorithm';
}) {
  const [saving, setSaving] = useState(false);

  const onClick = async () => {
    const card = cardRef.current;
    const grid = chartGridIn(card);
    if (!card || !grid || saving) {
      return;
    }
    setSaving(true);
    try {
      await saveChartGrid(grid, chartsFilename(card, kind));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Button variant="secondary" disabled={saving} onClick={() => void onClick()}>
      {saving ? 'Saving...' : 'Save'}
    </Button>
  );
}
