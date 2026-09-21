import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRotate } from '@fortawesome/free-solid-svg-icons';
import { Button } from '../primitives/Button';
import { Heading } from '../primitives/Heading';
import { Panel } from '../primitives/Panel';

/**
 * What a page shows when the data it loads on opening could not be read (ADR 0069, failure class "page data"): the page keeps its
 * title, says what happened in plain words and offers Retry, and the navigation around it keeps working. The technical text is
 * in the host log.
 */
export function LoadError({ title, message, retry }: { title: string; message: string; retry: () => void }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <Heading title={title} />
      <Panel title="This page could not be loaded">
        <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          {message}
        </p>
        <Button variant="primary" className="mt-4" onClick={retry}>
          <FontAwesomeIcon icon={faRotate} />
          Retry
        </Button>
      </Panel>
    </div>
  );
}
