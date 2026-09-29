import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import type { DeliveryProfile, PackagePreview } from '../../types';

export type PackagePreviewState = { preview?: PackagePreview; problem?: string };

/**
 * The files the delivery package will create for the profile Master & QC judges against (mock 05's OUTPUTS list, "Preview naming"):
 * read from the host, which names them with the code the package build writes with, so the list cannot disagree with the build.
 * It reads again when the profile or its version changes and builds nothing.
 */
export function usePackagePreview(profile: DeliveryProfile | undefined): PackagePreviewState {
  const api = useApi();
  const [state, setState] = useState<PackagePreviewState>({});
  const id = profile?.id;
  const version = profile?.version;

  useEffect(() => {
    if (id === undefined || version === undefined) {
      setState({});
      return;
    }
    let active = true;
    api
      .packagePreview(id, version)
      .then((preview) => active && setState({ preview }))
      .catch((error) => active && setState({ problem: apiErrorMessage(error) }));
    return () => {
      active = false;
    };
  }, [api, id, version]);

  return state;
}
