import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CalendarDays, Check, CheckCircle2, ChevronDown, Download, Eye, FolderOpen, Info, KeyRound, LogOut, Pencil, Plus, Search, Trash2, Upload, UserPlus, X } from 'lucide-react';
import { categoryGroups, yearOptions } from '../data/categories';

const PdfPreview = lazy(() => import('./PdfPreview'));

const defaultNewDocument = {
  title: '',
  format: 'PDF',
  year_period: 2026,
};

const fileFormats = {
  pdf: 'PDF',
  xls: 'XLS',
  xlsx: 'XLSX',
  doc: 'DOC',
  docx: 'DOCX',
};

function getFileFormatLabel(fileName) {
  const extensionIndex = fileName.lastIndexOf('.');
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex + 1).toLowerCase() : '';
  return fileFormats[extension] || (extension ? extension.toUpperCase().slice(0, 16) : 'FILE');
}

const periodOptions = [
  { value: 'all', label: 'Semua Periode' },
  ...yearOptions.map((year) => ({ value: year, label: String(year) })),
];

function PeriodSelector({ value, options, onChange, fullWidth = false, label = 'Pilih periode dokumen' }) {
  const listboxId = useId();
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const triggerRef = useRef(null);
  const optionRefs = useRef([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState(null);
  const selectedValue = value === 'all' ? 'all' : String(value);
  const selectedIndex = options.findIndex((option) => String(option.value) === selectedValue);
  const selectedOption = options[selectedIndex] || options[0];

  useEffect(() => {
    if (!isOpen) return undefined;
    const updateMenuPosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const bounds = trigger.getBoundingClientRect();
      const viewportPadding = 10;
      const gap = 6;
      const maxMenuHeight = 164;
      const availableBelow = window.innerHeight - bounds.bottom - gap - viewportPadding;
      const availableAbove = bounds.top - gap - viewportPadding;
      const opensAbove = availableBelow < maxMenuHeight && availableAbove > availableBelow;
      const availableSpace = opensAbove ? availableAbove : availableBelow;
      const maxHeight = Math.max(38, Math.min(maxMenuHeight, availableSpace));
      const top = opensAbove
        ? Math.max(viewportPadding, bounds.top - gap - maxHeight)
        : Math.min(bounds.bottom + gap, window.innerHeight - maxHeight - viewportPadding);
      const width = Math.min(bounds.width, window.innerWidth - viewportPadding * 2);
      const left = Math.max(viewportPadding, Math.min(bounds.left, window.innerWidth - width - viewportPadding));

      setMenuPosition({ top, left, width, maxHeight });
    };
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target) && !listRef.current?.contains(event.target)) setIsOpen(false);
    };
    updateMenuPosition();
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', updateMenuPosition);
    document.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', updateMenuPosition);
      document.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      const activeOption = optionRefs.current[activeIndex];
      activeOption?.focus({ preventScroll: true });
      activeOption?.scrollIntoView({ block: 'nearest' });
    }
  }, [isOpen, activeIndex, menuPosition]);

  const openOptions = (index = selectedIndex) => {
    setActiveIndex(Math.max(0, index));
    setIsOpen(true);
  };

  const moveActiveOption = (event, index, direction) => {
    event.preventDefault();
    const nextIndex = Math.max(0, Math.min(options.length - 1, index + direction));
    setActiveIndex(nextIndex);
  };

  const chooseOption = (option) => {
    onChange(option.value === 'all' ? 'all' : Number(option.value));
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className={`period-selector ${fullWidth ? 'period-selector-full' : ''}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="period-selector-trigger"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        onClick={() => (isOpen ? setIsOpen(false) : openOptions())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openOptions(selectedIndex + (event.key === 'ArrowDown' ? 1 : -1));
          } else if (event.key === 'Escape') {
            setIsOpen(false);
          }
        }}
      >
        <CalendarDays size={17} aria-hidden="true" />
        <span>{selectedOption?.label}</span>
        <ChevronDown size={17} aria-hidden="true" className={isOpen ? 'is-open' : ''} />
      </button>

      {isOpen && menuPosition ? createPortal(
        <div
          ref={listRef}
          id={listboxId}
          className="period-selector-list"
          role="listbox"
          aria-label={label}
          style={{ top: menuPosition.top, left: menuPosition.left, width: menuPosition.width, maxHeight: menuPosition.maxHeight }}
        >
          {options.map((option, index) => {
            const isSelected = String(option.value) === selectedValue;
            return (
              <button
                key={option.value}
                ref={(element) => { optionRefs.current[index] = element; }}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`period-selector-option ${isSelected ? 'is-selected' : ''} ${activeIndex === index ? 'is-active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => chooseOption(option)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') moveActiveOption(event, index, 1);
                  else if (event.key === 'ArrowUp') moveActiveOption(event, index, -1);
                  else if (event.key === 'Home') { event.preventDefault(); setActiveIndex(0); }
                  else if (event.key === 'End') { event.preventDefault(); setActiveIndex(options.length - 1); }
                  else if (event.key === 'Escape') { event.preventDefault(); setIsOpen(false); triggerRef.current?.focus(); }
                }}
              >
                <span>{option.label}</span>
                {isSelected ? <Check size={16} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

function DocumentActions({ doc, onDownload, onPreview, onDetail, onEdit, onDelete, canManage }) {
  return (
    <div className="action-group">
      <button type="button" className="icon-button" title={doc.file_state !== 'available' ? 'Periksa file sebelum mengunduh' : 'Unduh dokumen'} aria-label={`Unduh ${doc.title}`} onClick={() => onDownload(doc.id)}>
        <Download size={17} aria-hidden="true" />
      </button>
      <button type="button" className="icon-button" title={doc.file_state !== 'available' ? 'Periksa file sebelum melihat pratinjau' : 'Buka pratinjau'} aria-label={`Pratinjau ${doc.title}`} onClick={() => onPreview(doc.id)}>
        <Eye size={17} aria-hidden="true" />
      </button>
      <button type="button" className="icon-button" title="Lihat detail" aria-label={`Detail ${doc.title}`} onClick={() => onDetail(doc)}>
        <Info size={17} aria-hidden="true" />
      </button>
      {canManage ? (
        <>
          <button type="button" className="icon-button" title="Edit dokumen" aria-label={`Edit ${doc.title}`} onClick={() => onEdit(doc)}>
            <Pencil size={17} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button danger-button" title="Hapus dokumen" aria-label={`Hapus ${doc.title}`} onClick={() => onDelete(doc)}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </>
      ) : null}
    </div>
  );
}

function fileNeedsRepair(doc) {
  return doc.file_available === false || ['missing', 'changed', 'corrupt'].includes(doc.file_state);
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** unitIndex)).toFixed(unitIndex ? 1 : 0)} ${units[unitIndex]}`;
}

function DocumentTitle({ doc, showCategory = false }) {
  return (
    <div className="document-title-cell">
      <span className="document-name" title={doc.title}>{doc.title}</span>
      {showCategory ? <span className="document-category-label">{doc.category}</span> : null}
      {doc.file_state && doc.file_state !== 'available' ? (
        <span className="file-missing-badge">
          <AlertTriangle size={13} aria-hidden="true" />
          {doc.file_state === 'missing' ? 'File tidak tersedia' : doc.file_state === 'changed' ? 'Isi file berubah' : doc.file_state === 'corrupt' ? 'File rusak' : 'Belum diverifikasi'}
        </span>
      ) : null}
    </div>
  );
}

export default function Dashboard({ onLogout, user }) {
  const canManage = user?.role === 'admin' || user?.role === 'editor';
  const [activeGroup, setActiveGroup] = useState(categoryGroups[0].group);
  const [activeCategory, setActiveCategory] = useState(categoryGroups[0].items[0]);
  const [selectedYear, setSelectedYear] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [documents, setDocuments] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(defaultNewDocument);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isFileReading, setIsFileReading] = useState(false);
  const [isSavingDocument, setIsSavingDocument] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [detailDoc, setDetailDoc] = useState(null);
  const [previewPdf, setPreviewPdf] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [toast, setToast] = useState(null);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteUsername, setInviteUsername] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const [inviteCode, setInviteCode] = useState('');
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const toastTimerRef = useRef(null);
  const reportedFileIssues = useRef(new Map());

  useEffect(() => {
    if (!toast) return undefined;
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(toastTimerRef.current);
  }, [toast]);

  const showDialog = (title, message, type = 'error', action = null) => {
    setDialog({ title, message, type, ...action });
  };

  const askConfirmation = ({ title, message, confirmLabel = 'Lanjutkan', danger = false }) => new Promise((resolve) => {
    setDialog({ title, message, type: 'confirm', confirmLabel, danger, resolve });
  });

  const closeDialog = (confirmed = false) => {
    const activeDialog = dialog;
    setDialog(null);
    activeDialog?.resolve?.(confirmed);
  };

  useEffect(() => {
    if (!dialog) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dialog]);

  const showToast = (title, message, type = 'success') => {
    setToast({ title, message, type });
  };

  const loadDocuments = async () => {
    try {
      const result = await window.electronAPI.getDocuments();
      if (!Array.isArray(result)) throw new Error('Aplikasi menerima data dokumen dengan format yang tidak dikenali.');
      const loadedDocuments = result;
      setDocuments(loadedDocuments);
      const fileIssues = loadedDocuments.filter((doc) => ['missing', 'changed'].includes(doc.file_state));
      const currentIssueIds = new Set(fileIssues.map((doc) => doc.id));
      for (const documentId of reportedFileIssues.current.keys()) {
        if (!currentIssueIds.has(documentId)) reportedFileIssues.current.delete(documentId);
      }
      const newlyReportedIssues = fileIssues.filter((doc) => reportedFileIssues.current.get(doc.id) !== doc.file_state);
      for (const doc of newlyReportedIssues) reportedFileIssues.current.set(doc.id, doc.file_state);
      if (newlyReportedIssues.length) {
        const issueNames = newlyReportedIssues
          .slice(0, 5)
          .map((doc) => `- ${doc.title} — ${doc.file_name} (${doc.file_state === 'missing' ? 'file tidak ditemukan' : 'file berubah'})`)
          .join('\n');
        const additionalIssues = newlyReportedIssues.length > 5
          ? `\n- dan ${newlyReportedIssues.length - 5} file lainnya`
          : '';
        showDialog(
          'Lampiran perlu diperiksa',
          `Aplikasi menemukan file lampiran yang hilang atau berubah. Catatan dokumen tetap tersimpan, tetapi lampiran bermasalah tidak dapat dibuka dengan aman.\n\n${issueNames}${additionalIssues}\n\nPilih Perbaiki File untuk memilih salinan dokumen yang benar. File sumber asli yang dipilih saat unggah tidak diperlukan lagi karena aplikasi menyimpan salinannya sendiri.`,
          'warning',
          {
            actionLabel: 'Perbaiki File',
            onAction: () => {
              const document = newlyReportedIssues[0];
              const group = categoryGroups.find((item) => item.items.includes(document.category));
              if (group) {
                setActiveGroup(group.group);
                setActiveCategory(document.category);
              }
              setSelectedYear('all');
              setSearchTerm('');
              handleEdit(document);
            },
          },
        );
      }
    } catch (error) {
      showDialog('Daftar dokumen gagal dimuat', error.message || 'Periksa sesi login dan database, lalu coba kembali.', 'error');
    }
  };

  useEffect(() => {
    loadDocuments();
    const unsubscribe = window.electronAPI.onDocumentsChanged?.(() => loadDocuments());
    const monitor = window.setInterval(loadDocuments, 30_000);
    return () => {
      window.clearInterval(monitor);
      unsubscribe?.();
    };
  }, []);

  const matchingSearchDocuments = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    if (!normalizedSearch) return [];

    return documents.filter((doc) =>
      [doc.title, doc.file_name, doc.category, doc.year_period]
        .some((value) => String(value || '').toLowerCase().includes(normalizedSearch)),
    );
  }, [documents, searchTerm]);

  const matchingSearchCategories = useMemo(
    () => [...new Set(matchingSearchDocuments.map((doc) => doc.category))],
    [matchingSearchDocuments],
  );

  useEffect(() => {
    if (matchingSearchCategories.length !== 1) return;
    const matchedCategory = matchingSearchCategories[0];
    const matchedGroup = categoryGroups.find((group) => group.items.includes(matchedCategory));
    if (!matchedGroup) return;
    setActiveCategory(matchedCategory);
    setActiveGroup(matchedGroup.group);
  }, [matchingSearchCategories]);

  const filteredDocuments = useMemo(() => {
    if (searchTerm.trim()) return matchingSearchDocuments;
    return documents.filter((doc) => doc.category === activeCategory);
  }, [documents, activeCategory, matchingSearchDocuments, searchTerm]);

  const categoryHeading = searchTerm.trim() && matchingSearchCategories.length > 1
    ? 'Hasil Pencarian (Berbagai Kategori)'
    : matchingSearchCategories.length === 1
      ? matchingSearchCategories[0]
      : activeCategory;

  const totalRecords = filteredDocuments.length;
  const availableRecords = filteredDocuments.filter((doc) => !fileNeedsRepair(doc)).length;
  const categoriesInUse = new Set(filteredDocuments.map((doc) => doc.category)).size;

  const currentYearDocs = useMemo(() => {
    if (selectedYear === 'all') {
      const firstYear = yearOptions[0];
      const lastYear = yearOptions[yearOptions.length - 1];
      return filteredDocuments.filter((doc) => Number(doc.year_period) >= firstYear && Number(doc.year_period) <= lastYear);
    }
    return filteredDocuments.filter((doc) => Number(doc.year_period) === Number(selectedYear));
  }, [filteredDocuments, selectedYear]);

  const previousYearDocs = useMemo(() => {
    if (selectedYear === 'all') {
      return filteredDocuments.filter((doc) => Number(doc.year_period) < yearOptions[0]);
    }
    const targetYear = Number(selectedYear) - 1;
    return filteredDocuments.filter((doc) => Number(doc.year_period) === Number(targetYear));
  }, [filteredDocuments, selectedYear]);

  const resetDraft = () => {
    setDraft(defaultNewDocument);
    setSelectedFiles([]);
    setIsFileReading(false);
    setIsSavingDocument(false);
    setUploadProgress(null);
    setEditingId(null);
  };

  const openCreateModal = () => {
    resetDraft();
    setDraft({ ...defaultNewDocument, category: categoryHeading.startsWith('Hasil Pencarian') ? activeCategory : categoryHeading });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (isSavingDocument) return;
    setIsModalOpen(false);
    resetDraft();
  };

  const handleCategoryClick = (groupName, categoryName) => {
    setActiveGroup(groupName);
    setActiveCategory(categoryName);
    setSelectedYear('all');
    setSearchTerm('');
    closeModal();
  };

  const handleFilesSelected = async (files) => {
    const normalized = Array.from(files || []).filter(Boolean);
    if (!normalized.length) return;

    const file = normalized[0];
    const format = getFileFormatLabel(file.name);

    setIsFileReading(true);
    try {
      const sourcePath = await window.electronAPI.getPathForFile(file);
      if (!sourcePath) throw new Error('Lokasi file tidak tersedia. Pilih file dari perangkat, bukan file sementara.');
      setSelectedFiles([file]);
      setDraft((prev) => ({
        ...prev,
        title: prev.title || file.name.replace(/\.[^/.]+$/, ''),
        file_name: file.name,
        source_path: sourcePath,
        format,
      }));
    } catch (error) {
      setSelectedFiles([]);
      showDialog('File tidak dapat dipilih', error.message || 'Periksa lokasi file lalu pilih kembali.', 'error');
    } finally {
      setIsFileReading(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (isFileReading) {
      showDialog('File sedang diperiksa', 'Tunggu sampai nama dan ukuran file tampil sebelum menyimpan.', 'info');
      return;
    }

    if (editingId && fileNeedsRepair(draft) && !selectedFiles.length) {
      showDialog('File perlu diganti', 'File lama hilang atau integritasnya berubah. Pilih file pengganti sebelum menyimpan.', 'warning');
      return;
    }

    const fileName = selectedFiles[0]?.name || (editingId ? draft.file_name : '');
    if (!fileName) {
      showDialog('Lampiran belum dipilih', 'Pilih file dokumen sebelum menyimpan catatan ini.', 'warning');
      return;
    }

    const format = selectedFiles.length ? getFileFormatLabel(fileName) : draft.format;

    const title = draft.title.trim() || `${draft.category} ${draft.year_period}`;
    const confirmed = await askConfirmation({
      title: editingId ? 'Konfirmasi perubahan dokumen' : 'Konfirmasi dokumen baru',
      message: `Pastikan data berikut benar sebelum disimpan.\n\nNama dokumen: ${title}\nKategori: ${draft.category}\nFile: ${fileName}\nFormat: ${format}`,
      confirmLabel: editingId ? 'Simpan Perubahan' : 'Tambahkan Dokumen',
    });
    if (!confirmed) return;

    const payload = {
      id: editingId,
      title,
      category: draft.category,
      format,
      year_period: Number(draft.year_period || 2025),
      file_name: fileName,
      source_path: selectedFiles.length ? draft.source_path : undefined,
      operationId: window.crypto.randomUUID(),
    };

    let result;
    setIsSavingDocument(true);
    setUploadProgress({ phase: 'validating', copiedBytes: 0, totalBytes: selectedFiles[0]?.size || 0 });
    try {
      const onProgress = (progress) => setUploadProgress(progress);
      result = editingId
        ? await window.electronAPI.updateDocument(payload, onProgress)
        : await window.electronAPI.createDocument(payload, onProgress);
    } catch (error) {
      showDialog('Dokumen gagal disimpan', error.message || 'Catatan belum berubah. Periksa ruang penyimpanan dan izin folder, lalu coba kembali.', 'error');
      return;
    } finally {
      setIsSavingDocument(false);
      setUploadProgress(null);
    }

    if (result && result.success) {
      const savedCategory = draft.category;
      const savedGroup = categoryGroups.find((group) => group.items.includes(savedCategory));
      setActiveCategory(savedCategory);
      if (savedGroup) setActiveGroup(savedGroup.group);
      setSelectedYear('all');
      setSearchTerm('');
      showToast(editingId ? 'Perubahan tersimpan' : 'Dokumen ditambahkan', `${title} berhasil disimpan.`, 'success');
      closeModal();
      await loadDocuments();
    } else {
      showDialog('Dokumen gagal disimpan', result?.message || 'Periksa file dan ruang penyimpanan, lalu coba kembali.', 'error');
    }
  };

  const updateDocumentFileState = (documentId, fileState) => {
    if (['missing', 'changed'].includes(fileState)) reportedFileIssues.current.set(documentId, fileState);
    else reportedFileIssues.current.delete(documentId);
    setDocuments((current) => current.map((doc) => doc.id === documentId
      ? { ...doc, file_available: fileState !== 'missing', file_state: fileState }
      : doc));
    setDetailDoc((current) => current?.id === documentId
      ? { ...current, file_available: fileState !== 'missing', file_state: fileState }
      : current);
  };

  const handleDownload = async (documentId) => {
    try {
      const result = await window.electronAPI.downloadDocument(documentId);
      if (result.success) {
        updateDocumentFileState(documentId, 'available');
        showToast('Unduhan selesai', `File disimpan di ${result.path}`, 'success');
      } else if (result.canceled) {
        return;
      } else {
        if (['FILE_MISSING', 'FILE_CHANGED'].includes(result.code)) {
          updateDocumentFileState(documentId, result.code === 'FILE_MISSING' ? 'missing' : 'changed');
        }
        showDialog(
          result.code === 'FILE_MISSING' ? 'File sumber tidak tersedia' : 'Unduhan gagal',
          result.message || 'Catatan dokumen tetap tersimpan. Periksa file dan ruang penyimpanan.',
          'error',
        );
      }
    } catch (error) {
      showDialog('Unduhan gagal', error.message || 'Terjadi kesalahan pada penyimpanan. Catatan dokumen tetap tersimpan.', 'error');
    }
  };

  const handlePreview = async (documentId) => {
    try {
      const result = await window.electronAPI.previewDocument(documentId);
      if (!result.success) {
        if (['FILE_MISSING', 'FILE_CHANGED'].includes(result.code)) {
          updateDocumentFileState(documentId, result.code === 'FILE_MISSING' ? 'missing' : 'changed');
        }
        showDialog('File tidak dapat dibuka', result.message || 'Catatan dokumen tetap tersimpan. Periksa file atau pilih file pengganti.', 'error');
      } else if (result.mode === 'pdf') {
        updateDocumentFileState(documentId, 'available');
        const document = documents.find((item) => item.id === documentId);
        setPreviewPdf({ id: documentId, fileName: result.fileName, data: result.data, title: document?.title || result.fileName });
      } else {
        updateDocumentFileState(documentId, 'available');
      }
    } catch (error) {
      showDialog('Pratinjau gagal', error.message || 'Catatan dokumen tetap tersimpan. Periksa kondisi file dan aplikasi pembuka.', 'error');
    }
  };

  const handleEdit = (doc) => {
    const fileName = doc.file_name || (doc.file_path ? doc.file_path.split(/[\\/]/).pop() : '');
    const fileExtension = fileName.split('.').pop().toLowerCase();
    setEditingId(doc.id);
    setDraft({
      title: doc.title,
      category: doc.category,
      format: fileFormats[fileExtension] || doc.format,
      year_period: Number(doc.year_period),
      file_name: fileName,
      file_available: doc.file_available !== false,
      file_state: doc.file_state || (doc.file_available === false ? 'missing' : 'available'),
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (doc) => {
    const confirmed = await askConfirmation({
      title: 'Hapus dokumen?',
      message: `Dokumen "${doc.title}" dan file lampirannya akan dihapus dari penyimpanan aplikasi. Tindakan ini tidak dapat dibatalkan.`,
      confirmLabel: 'Hapus Dokumen',
      danger: true,
    });
    if (!confirmed) return;

    try {
      const result = await window.electronAPI.deleteDocument(doc.id);
      if (!result.success) {
        showDialog('Dokumen tidak terhapus', result.message || 'Periksa database dan coba kembali.', 'error');
        return;
      }
      if (detailDoc?.id === doc.id) closeDetail();
      await loadDocuments();
      showToast('Dokumen dihapus', `Catatan "${doc.title}" berhasil dihapus.`, 'success');
    } catch (error) {
      showDialog('Penghapusan gagal', error.message || 'Terjadi kesalahan saat menghapus dokumen. Data belum dipastikan terhapus.', 'error');
    }
  };

  const handleDetail = (doc) => setDetailDoc(doc);
  const closeDetail = () => setDetailDoc(null);

  const handleCreateRecoveryCode = async () => {
    try {
      if (typeof window.electronAPI.createRecoveryCode !== 'function') {
        showDialog(
          'Aplikasi perlu diperbarui',
          'Versi aplikasi yang sedang berjalan belum memiliki fitur kode pemulihan. Tutup aplikasi lalu jalankan build/installer E-Arsip Instansi yang terbaru.',
          'warning',
        );
        return;
      }
      const result = await window.electronAPI.createRecoveryCode();
      if (!result.success) {
        showDialog('Kode pemulihan gagal dibuat', result.message || 'Coba kembali.', 'error');
        return;
      }
      showDialog(
        'Simpan Kode Pemulihan',
        `Kode ini hanya ditampilkan sekarang dan menggantikan kode sebelumnya:\n\n${result.recoveryCode}\n\nSimpan di tempat aman dan jangan bagikan kepada orang lain.`,
        'info',
      );
    } catch (error) {
      showDialog('Kode pemulihan gagal dibuat', error.message || 'Periksa sesi login lalu coba kembali.', 'error');
    }
  };

  const handleCreateInvitation = async (event) => {
    event.preventDefault();
    setIsCreatingInvite(true);
    try {
      const result = await window.electronAPI.createInvitation({ username: inviteUsername.trim(), role: inviteRole });
      if (!result.success) {
        showDialog('Undangan gagal dibuat', result.message || 'Periksa username dan coba kembali.', 'error');
        return;
      }
      setInviteCode(result.inviteCode);
    } catch (error) {
      showDialog('Undangan gagal dibuat', error.message || 'Periksa koneksi server lalu coba kembali.', 'error');
    } finally {
      setIsCreatingInvite(false);
    }
  };

  const closeInviteModal = () => {
    setIsInviteOpen(false);
    setInviteUsername('');
    setInviteRole('editor');
    setInviteCode('');
  };

  return (
    <div className="dashboard-shell">
      <aside className="sidebar-panel">
        <div className="sidebar-header">
          <div className="mini-logo">E</div>
          <div>
            <p className="sidebar-kicker">Arsip</p>
            <h2>Menu Kategori</h2>
          </div>
        </div>

        <nav className="category-navigation" aria-label="Kategori dokumen">
          {categoryGroups.map((group) => (
            <div key={group.group} className="category-group">
              <div className={`group-title ${activeGroup === group.group ? 'is-active' : ''}`}>
                {group.group}
              </div>
              <div className="subnav-list">
                {group.items.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`subnav-item ${activeCategory === item ? 'selected' : ''}`}
                    onClick={() => handleCategoryClick(group.group, item)}
                    aria-current={activeCategory === item ? 'page' : undefined}
                  >
                    <span className="subnav-item-label">{item}</span>
                    <span className="subnav-count">{documents.filter((doc) => doc.category === item).length}</span>
                    {activeCategory === item ? <Check size={15} className="category-selected-mark" aria-hidden="true" /> : null}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <button type="button" className="logout-button" onClick={handleCreateRecoveryCode}>
          <KeyRound size={17} aria-hidden="true" />
          Buat Kode Pemulihan
        </button>
        {user?.role === 'admin' ? (
          <button type="button" className="logout-button" onClick={() => setIsInviteOpen(true)}>
            <UserPlus size={17} aria-hidden="true" />
            Undang Pengguna
          </button>
        ) : null}
        <button type="button" className="logout-button" onClick={onLogout}>
          <LogOut size={17} aria-hidden="true" />
          Logout
        </button>
      </aside>

      <main className="dashboard-main">
        <header className="topbar">
          <div>
            <h1>Data dan Informasi Terkait Kinerja Instansi</h1>
            <p className="muted-label">Masuk sebagai {user?.username} · {user?.role}</p>
          </div>

          <div className="header-tools">
            <div className="search-box">
              <Search size={18} aria-hidden="true" />
              <input
                type="text"
                placeholder="Cari nama dokumen atau kategori..."
                aria-label="Cari nama dokumen atau kategori"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
            {searchTerm.trim() ? <span className="search-scope">Hasil mencakup semua kategori</span> : null}
          </div>
        </header>

        <section className="stats-grid">
          <div className="stat-card">
            <span>Total Dokumen</span>
            <strong>{totalRecords}</strong>
          </div>
          <div className="stat-card success">
            <span>Lampiran Siap Diakses</span>
            <strong>{availableRecords}</strong>
          </div>
          <div className="stat-card">
            <span>Kategori Terisi</span>
            <strong>{categoriesInUse}</strong>
          </div>
        </section>

        <section className="workspace-panel">
          <div className="toolbar-header">
            <div>
              <p className="muted-label">{categoryHeading.startsWith('Hasil Pencarian') ? 'Hasil pencarian' : 'Dokumen dalam kategori'}</p>
              <h2>{categoryHeading}</h2>
            </div>

            <div className="toolbar-actions">
              <PeriodSelector
                value={selectedYear}
                options={periodOptions}
                onChange={setSelectedYear}
              />

              {canManage ? <button
                type="button"
                className="primary-button"
                title={`Tambah dokumen untuk ${categoryHeading.startsWith('Hasil Pencarian') ? activeCategory : categoryHeading}`}
                onClick={openCreateModal}
              >
                <Plus size={17} aria-hidden="true" />
                Tambah Dokumen
              </button> : null}
            </div>
          </div>

          <div className="documents-grid">
            <section className="document-panel">
              <div className="panel-header">
                <h3>{selectedYear === 'all' ? `Semua Periode (${yearOptions[0]}–${yearOptions[yearOptions.length - 1]})` : `Periode Dokumen ${selectedYear}`}</h3>
              </div>
              <div className="document-table-wrap">
              <table className="documents-table">
                <thead>
                  <tr>
                    <th>Nama Dokumen</th>
                    <th>Format</th>
                    <th>Periode/TA</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {currentYearDocs.length > 0 ? (
                    currentYearDocs.map((doc) => (
                      <tr key={doc.id}>
                        <td><DocumentTitle doc={doc} showCategory={Boolean(searchTerm.trim())} /></td>
                        <td>{doc.format}</td>
                        <td>{doc.year_period}</td>
                        <td>
                          <DocumentActions doc={doc} onDownload={handleDownload} onPreview={handlePreview} onDetail={handleDetail} onEdit={handleEdit} onDelete={handleDelete} canManage={canManage} />
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="4" className="empty-cell">
                        {canManage ? 'Belum ada dokumen pada periode ini. Pilih “Tambah Dokumen” untuk menyimpan berkas.' : 'Belum ada dokumen pada periode ini.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </section>

            <section className="document-panel">
              <div className="panel-header">
                <h3>{selectedYear === 'all' ? `Arsip Sebelum ${yearOptions[0]}` : 'Arsip Tahun Sebelumnya'}</h3>
              </div>
              <div className="document-table-wrap">
              <table className="documents-table">
                <thead>
                  <tr>
                    <th>Nama Dokumen</th>
                    <th>Format</th>
                    <th>Periode/TA</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {previousYearDocs.length > 0 ? (
                    previousYearDocs.map((doc) => (
                      <tr key={doc.id}>
                        <td><DocumentTitle doc={doc} showCategory={Boolean(searchTerm.trim())} /></td>
                        <td>{doc.format}</td>
                        <td>{doc.year_period}</td>
                        <td>
                          <DocumentActions doc={doc} onDownload={handleDownload} onPreview={handlePreview} onDetail={handleDetail} onEdit={handleEdit} onDelete={handleDelete} canManage={canManage} />
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="4" className="empty-cell">
                        Tidak ada arsip tahun sebelumnya.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </section>

          </div>
        </section>
      </main>

      {detailDoc ? (
        <div className="modal-backdrop" onClick={closeDetail}>
          <div className="document-modal detail-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="muted-label">Detail Dokumen</p>
                <h3>{detailDoc.title}</h3>
              </div>
              <button type="button" className="close-button" aria-label="Tutup detail" title="Tutup" onClick={closeDetail}>
                <X size={19} aria-hidden="true" />
              </button>
            </div>

            <div className="detail-grid">
              <div className="detail-card">
                <span>Nama Dokumen</span>
                <strong>{detailDoc.title}</strong>
              </div>
              <div className="detail-card">
                <span>Kategori</span>
                <strong>{detailDoc.category}</strong>
              </div>
              <div className="detail-card">
                <span>Format</span>
                <strong>{detailDoc.format}</strong>
              </div>
              <div className="detail-card">
                <span>Periode / TA</span>
                <strong>{detailDoc.year_period}</strong>
              </div>
              <div className="detail-card">
                <span>File</span>
                <strong>{detailDoc.file_name || (detailDoc.file_path ? detailDoc.file_path.split(/[\\/]/).pop() : '-')}</strong>
              </div>
              <div className="detail-card">
                <span>Ketersediaan File</span>
                <strong className={fileNeedsRepair(detailDoc) ? 'missing-file-text' : 'available-file-text'}>
                  {detailDoc.file_state === 'missing' || detailDoc.file_available === false
                    ? 'File tidak tersedia'
                    : detailDoc.file_state === 'changed'
                      ? 'Isi file berubah'
                      : detailDoc.file_state === 'corrupt'
                        ? 'File tidak valid'
                        : detailDoc.file_state === 'unverified'
                          ? 'Belum diverifikasi'
                          : 'Tersedia dan ukuran sesuai'}
                </strong>
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={closeDetail}>
                Tutup
              </button>
              {canManage && fileNeedsRepair(detailDoc) ? (
                <button type="button" className="primary-button" onClick={() => { closeDetail(); handleEdit(detailDoc); }}>
                  <Upload size={16} aria-hidden="true" />
                  Pilih File Pengganti
                </button>
              ) : (
                <button type="button" className="primary-button" onClick={() => handlePreview(detailDoc.id)}>
                  Lihat File
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {isInviteOpen ? (
        <div className="modal-backdrop" onClick={closeInviteModal}>
          <form className="document-modal invite-modal" onSubmit={handleCreateInvitation} onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="muted-label">Akses Pengguna</p>
                <h3>Undang Pengguna Baru</h3>
              </div>
              <button type="button" className="close-button" aria-label="Tutup undangan" title="Tutup" onClick={closeInviteModal}>
                <X size={19} aria-hidden="true" />
              </button>
            </div>
            {inviteCode ? (
              <div className="recovery-code-notice" role="status">
                <p>Kode undangan ini hanya ditampilkan sekali, terikat pada username yang dipilih, dan berlaku selama tujuh hari. Sampaikan kode ini secara pribadi kepada pengguna yang diundang.</p>
                <code>{inviteCode}</code>
              </div>
            ) : (
              <>
                <p className="invite-intro">
                  Berikan akses ke arsip instansi dengan memilih username dan tingkat izin yang sesuai dengan tugas pengguna.
                </p>
                <div className="invite-form-fields">
                  <label>
                    <span>Username pengguna</span>
                    <input
                      value={inviteUsername}
                      onChange={(event) => setInviteUsername(event.target.value)}
                      minLength={3}
                      maxLength={32}
                      pattern="[a-zA-Z0-9._-]{3,32}"
                      autoComplete="off"
                      aria-describedby="invite-username-help"
                      placeholder="Contoh: nama.pengguna"
                      required
                    />
                    <span className="invite-field-help" id="invite-username-help">
                      Gunakan 3-32 karakter: huruf, angka, titik, garis bawah, atau tanda hubung.
                    </span>
                  </label>
                  <label>
                    <span>Peran dan hak akses</span>
                    <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)} aria-describedby="invite-role-help">
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                      <option value="admin">Admin</option>
                    </select>
                    <span className="invite-field-help" id="invite-role-help">
                      {inviteRole === 'admin'
                        ? 'Dapat mengelola pengguna dan seluruh dokumen. Berikan peran ini hanya kepada pengelola tepercaya.'
                        : inviteRole === 'viewer'
                          ? 'Dapat melihat dan mengunduh dokumen, tetapi tidak dapat menambah atau mengubah arsip.'
                          : 'Dapat menambah, mengubah, dan menghapus dokumen, tetapi tidak dapat mengelola pengguna.'}
                    </span>
                  </label>
                </div>
              </>
            )}
            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={closeInviteModal}>
                {inviteCode ? 'Tutup' : 'Batal'}
              </button>
              {!inviteCode ? (
                <button type="submit" className="primary-button" disabled={isCreatingInvite}>
                  {isCreatingInvite ? 'Membuat...' : 'Buat Kode Undangan'}
                </button>
              ) : null}
            </div>
          </form>
        </div>
      ) : null}

      {isModalOpen ? (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="document-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="muted-label">Dokumen</p>
                <h3>{editingId ? 'Edit Dokumen' : 'Tambah Dokumen Baru'}</h3>
              </div>
              <button type="button" className="close-button" aria-label="Tutup formulir" title="Tutup" onClick={closeModal}>
                <X size={19} aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="document-category-callout" aria-live="polite">
                <div className="category-callout-icon">
                  <FolderOpen size={20} aria-hidden="true" />
                </div>
                <div className="category-callout-copy">
                  <span>Kategori dokumen</span>
                  <strong>{draft.category}</strong>
                </div>
                <p>
                  {draft.category === 'Anggaran'
                    ? 'Pilih kategori Anggaran, lalu unggah file dalam format apa pun.'
                    : 'Pilih kategori yang sesuai; format file apa pun dapat diunggah.'}
                </p>
              </div>

              <div className="dropzone"
                   onDragOver={(event) => event.preventDefault()}
                   onDrop={(event) => {
                     event.preventDefault();
                     handleFilesSelected(event.dataTransfer.files);
                   }}>
                <input
                  type="file"
                  onChange={(event) => {
                    handleFilesSelected(event.target.files);
                    event.target.value = '';
                  }}
                />
                <div className="dropzone-inner">
                  <div className="upload-icon"><Upload size={26} aria-hidden="true" /></div>
                  <p>
                    {isFileReading
                      ? 'Sedang memeriksa file...'
                      : selectedFiles[0]?.name
                        || (editingId && fileNeedsRepair(draft)
                          ? `${draft.file_state === 'changed' ? 'File lama berubah' : 'File lama tidak ditemukan'} (${draft.file_name}). Pilih file pengganti.`
                          : editingId
                            ? draft.file_name
                            : 'Klik di sini atau seret file ke area ini')}
                  </p>
                  <span>{selectedFiles[0] ? formatFileSize(selectedFiles[0].size) : 'Semua format file didukung'}</span>
                  <small className="format-help">Salinan file disimpan di aplikasi. File asli Anda tidak diubah.</small>
                </div>
              </div>

              <div className="field-grid">
                <label>
                  <span>Nama Dokumen</span>
                  <input
                    type="text"
                    value={draft.title}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  />
                </label>

                <label>
                  <span>Kategori Dokumen</span>
                  <select
                    value={draft.category}
                    onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                    required
                  >
                    {categoryGroups.flatMap((group) => group.items).map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                  <small className="format-help">
                    Sistem akan memeriksa kecocokan kategori dengan nama dokumen dan file.
                  </small>
                </label>

                <label>
                  <span>Format File (Otomatis)</span>
                  <input
                    type="text"
                    value={selectedFiles[0]
                      ? getFileFormatLabel(selectedFiles[0].name)
                      : editingId
                        ? draft.format
                        : 'Pilih file untuk mendeteksi format'}
                    readOnly
                    aria-readonly="true"
                  />
                  <small className="format-help">
                    Format mengikuti ekstensi file. Pilih file pengganti untuk mengubahnya.
                  </small>
                </label>

                <label>
                  <span>Periode / Tahun</span>
                  <PeriodSelector
                    value={draft.year_period}
                    options={yearOptions.map((year) => ({ value: year, label: String(year) }))}
                    onChange={(year) => setDraft({ ...draft, year_period: year })}
                    fullWidth
                    label="Pilih periode dokumen baru"
                  />
                </label>

              </div>

              {isSavingDocument ? (
                <div className="upload-progress" role="status" aria-live="polite">
                  <div>
                    <span>{uploadProgress?.phase === 'validating' ? 'Memeriksa file...' : 'Menyimpan file...'}</span>
                    {uploadProgress?.phase === 'copying' && uploadProgress.totalBytes
                      ? <span>{Math.floor((uploadProgress.copiedBytes / uploadProgress.totalBytes) * 100)}%</span>
                      : null}
                  </div>
                  <progress
                    max={uploadProgress?.totalBytes || 1}
                    value={uploadProgress?.phase === 'copying' ? uploadProgress.copiedBytes : 0}
                  />
                </div>
              ) : null}

              <div className="modal-actions">
                <button type="button" className="ghost-button" disabled={isSavingDocument} onClick={closeModal}>
                  Batal
                </button>
                <button type="submit" className="primary-button" disabled={isFileReading || isSavingDocument}>
                  {isSavingDocument ? 'Menyimpan...' : isFileReading ? 'Memeriksa File...' : editingId ? 'Simpan Perubahan' : 'Simpan Dokumen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {previewPdf ? (
        <Suspense fallback={<div className="pdf-preview-loading-screen">Memuat viewer PDF...</div>}>
          <PdfPreview
            fileName={previewPdf.fileName}
            data={previewPdf.data}
            onClose={() => setPreviewPdf(null)}
            onInvalid={() => updateDocumentFileState(previewPdf.id, 'corrupt')}
          />
        </Suspense>
      ) : null}

      {toast ? (
        <div className={`feedback-toast feedback-toast-${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>
          <div className="feedback-toast-icon">
            <CheckCircle2 size={20} aria-hidden="true" />
          </div>
          <div className="feedback-toast-copy">
            <strong>{toast.title}</strong>
            <span>{toast.message}</span>
          </div>
          <button type="button" className="feedback-dismiss" aria-label="Tutup notifikasi" onClick={() => setToast(null)}>
            <X size={17} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {dialog ? (
        <div className="feedback-dialog-backdrop" onClick={() => closeDialog(false)}>
          <section
            className={`feedback-dialog feedback-dialog-${dialog.type}`}
            role={dialog.type === 'confirm' ? 'alertdialog' : 'dialog'}
            aria-modal="true"
            aria-labelledby="feedback-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="feedback-dialog-heading">
              <div className="feedback-dialog-icon">
                {dialog.type === 'confirm' || dialog.type === 'info' ? <Info size={22} aria-hidden="true" /> : <AlertTriangle size={22} aria-hidden="true" />}
              </div>
              <div>
                <h2 id="feedback-dialog-title">{dialog.title}</h2>
                <p>{dialog.message}</p>
              </div>
              <button type="button" className="feedback-dismiss" aria-label="Tutup dialog" onClick={() => closeDialog(false)}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="feedback-dialog-actions">
              {dialog.type === 'confirm' ? (
                <>
                  <button type="button" className="ghost-button" onClick={() => closeDialog(false)}>
                    Batal
                  </button>
                  <button
                    type="button"
                    className={dialog.danger ? 'danger-action-button' : 'primary-button'}
                    autoFocus
                    onClick={() => closeDialog(true)}
                  >
                    {dialog.confirmLabel}
                  </button>
                </>
              ) : (
                <>
                  {dialog.onAction ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        const action = dialog.onAction;
                        closeDialog(false);
                        action();
                      }}
                    >
                      {dialog.actionLabel}
                    </button>
                  ) : null}
                  <button type="button" className="primary-button" autoFocus onClick={() => closeDialog(false)}>
                    Mengerti
                  </button>
                </>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
