export interface Station {
  id: string;
  name: string;
  createdAt: number;
}

export interface Track {
  id: string;
  name: string;
  fileName: string;
  mimeType: string;
  size: number;
  addedAt: number;
}
