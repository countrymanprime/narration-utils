package main

import (
	"context"
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
)

// AssetsList is every approved asset of every kind with its state, size, publisher, licence and provenance links, where it is installed,
// when, and the download that is running for it (so a page opened while one runs can follow it). It reads no file contents.
func (h *Host) AssetsList() (string, error) { return encodeBinding(h.assetsList()) }

// AssetsInstall starts installing one asset, or repairs it when it is damaged, and answers with its job. A second call for an asset that is
// already downloading joins that job. The narrator asked for it: nothing else starts a download.
func (h *Host) AssetsInstall(kind, id string) (string, error) {
	return encodeBinding(h.startAssetInstall(kind, id))
}
func (h *Host) AssetsInstallState(jobID string) (string, error) {
	job, err := h.installJobByID(jobID, "asset")
	if err != nil {
		return "", err
	}
	return encodeBinding(snapshotInstall(job), nil)
}
func (h *Host) AssetsInstallCancel(jobID string) (string, error) {
	job, err := h.installJobByID(jobID, "asset")
	if err != nil {
		return "", err
	}
	job.cancel()
	return encodeBinding(snapshotInstall(job), nil)
}

// AssetsVerify reads every byte of one asset and answers with its state: installed, damaged (verification_failed) or absent.
func (h *Host) AssetsVerify(kind, id string) (string, error) {
	return encodeBinding(h.verifyAsset(kind, id))
}

// AssetsRemove deletes one asset. It refuses while the asset is downloading, and touches nothing else: not another asset, not a setting,
// not a project.
func (h *Host) AssetsRemove(kind, id string) (string, error) {
	return encodeBinding(nil, h.removeAsset(kind, id))
}

func (h *Host) assetsList() (map[string]any, error) {
	registry := h.registry()
	if len(registry.providers) == 0 {
		if registry.unavailable != "" {
			return nil, fmt.Errorf("the approved asset catalog is unavailable: %s", registry.unavailable)
		}
		return nil, fmt.Errorf("the approved asset catalog is unavailable")
	}
	entries := []map[string]any{}
	var installedBytes int64
	for _, provider := range registry.providers {
		for _, item := range provider.items() {
			state := provider.state(item.id)
			if state == "installed" {
				installedBytes += item.downloadSize()
			}
			entries = append(entries, assetEntry(provider, item, state, h.runningInstallID(item.kind, item.id)))
		}
	}
	return map[string]any{"cacheRoot": registry.base, "totalInstalledBytes": installedBytes, "assets": entries}, nil
}

// assetEntry is one row of the list. installedAt and verifiedAt come from the manifest (a small file), never from the asset itself.
func assetEntry(provider assetProvider, item assetItem, state, activeJob string) map[string]any {
	installedAt, verifiedAt := "", ""
	if state != "not_installed" {
		if manifest, err := assets.ReadManifest(item.dir); err == nil {
			installedAt, verifiedAt = manifest.InstalledAt, manifest.VerifiedAt
		}
	}
	return map[string]any{"kind": item.kind, "kindLabel": provider.label(), "id": item.id, "displayName": item.displayName, "version": item.version, "publisher": item.publisher,
		"license": item.license, "licenseUrl": item.licenseURL, "modelCardUrl": item.modelCardURL, "provenanceUrl": item.provenanceURL, "attribution": item.attribution,
		"downloadSize": item.downloadSize(), "installState": state, "path": item.dir, "installedAt": installedAt, "verifiedAt": verifiedAt, "activeJobId": activeJob}
}

// runningInstallID is the id of the download running for one asset, or "".
func (h *Host) runningInstallID(kind, id string) string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, job := range h.installJobs {
		if job.kind == kind && job.assetID == id && job.running() {
			return job.id
		}
	}
	return ""
}

func (h *Host) startAssetInstall(kind, id string) (map[string]any, error) {
	provider, item, err := h.registry().lookup(kind, id)
	if err != nil {
		return nil, err
	}
	return h.startInstall(installSpec{kind: kind, assetID: id, endedKind: provider.endedKind(), noun: provider.noun(), files: item.files,
		run: func(ctx context.Context, options assets.Options) error { return provider.install(ctx, id, options) }}), nil
}

func (h *Host) verifyAsset(kind, id string) (map[string]any, error) {
	provider, _, err := h.registry().lookup(kind, id)
	if err != nil {
		return nil, err
	}
	state, err := provider.verify(id)
	if err != nil {
		return nil, err
	}
	return map[string]any{"kind": kind, "id": id, "installState": state}, nil
}

func (h *Host) removeAsset(kind, id string) error {
	provider, _, err := h.registry().lookup(kind, id)
	if err != nil {
		return err
	}
	if h.runningInstallID(kind, id) != "" {
		return fmt.Errorf("the %s is downloading: cancel the download first", provider.noun())
	}
	return provider.remove(id)
}
