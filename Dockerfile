
FROM ubuntu:22.04
RUN apt-get update && apt-get upgrade -y
RUN apt-get install -y --no-install-recommends gcc g++ make python3 python3-dev python3-pip python3-venv python3-wheel espeak-ng libsndfile1-dev && rm -rf /var/lib/apt/lists/*
RUN pip3 install llvmlite --ignore-installed
RUN pip3 install TTS
# Set working directory
WORKDIR /app

# Install Node.js and npm
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_current.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Verify installations
RUN python3 --version && node --version && npm --version

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install fastapi[standard]
# Install Supervisor
RUN apt-get update && apt-get install -y supervisor \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
# Copy application code
COPY . .

# Install Node.js dependencies and build the project
RUN npm install next@latest -g
RUN npm install 
RUN npm run build



# Configure Supervisor
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Expose the port
EXPOSE 1602 1603

# Run Supervisor as the entry point
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]